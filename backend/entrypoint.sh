#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Единая точка входа контейнера. Режимы: api | worker | shell
# ---------------------------------------------------------------------------
set -euo pipefail

MODE="${1:-api}"

wait_for() {
    local host="$1" port="$2" label="$3" attempts=60
    until python -c "
import socket, sys
s = socket.socket()
s.settimeout(1)
try:
    s.connect(('${host}', ${port}))
except OSError:
    sys.exit(1)
" 2>/dev/null; do
        attempts=$((attempts - 1))
        if [ "$attempts" -le 0 ]; then
            echo "[entrypoint] ${label} недоступен (${host}:${port}) — сдаюсь" >&2
            exit 1
        fi
        echo "[entrypoint] жду ${label} (${host}:${port})…"
        sleep 1
    done
}

wait_for "${POSTGRES_HOST:-postgres}" "${POSTGRES_PORT:-5432}" postgres

case "$MODE" in
    api)
        # Миграции прогоняем платформенной ролью: у неё BYPASSRLS, поэтому
        # DDL и любые data-миграции не упираются в политики изоляции.
        echo "[entrypoint] migrate (платформенная роль)…"
        python manage.py migrate --database=platform --noinput

        if [ "${SEED_ON_START:-1}" = "1" ]; then
            # SEED_ARGS управляет объёмом сида: в проде — минимум (пустая строка →
            # только базовый демо-отель, чтобы резолвился поддомен); в dev —
            # полная история для наглядных дашбордов.
            echo "[entrypoint] seed_demo_hotel…"
            # Одинарный дефис: подставляем дефолт только если SEED_ARGS НЕ задана.
            # В проде SEED_ARGS="" (задана, но пустая) → минимальный сид.
            python manage.py seed_demo_hotel ${SEED_ARGS---with-guest-history --with-analytics-history} \
                || echo "[entrypoint] сид пропущен (уже есть?)"
        fi

        echo "[entrypoint] uvicorn (ASGI: HTTP + WebSocket)…"
        if [ "${UVICORN_RELOAD:-1}" = "1" ]; then
            # dev: авто-перезагрузка на правках, один процесс.
            exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 \
                --reload --reload-dir /app
        else
            # prod: без reload, воркеры по числу ядер (WEB_CONCURRENCY).
            exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 \
                --workers "${WEB_CONCURRENCY:-3}"
        fi
        ;;
    worker)
        exec celery -A config worker -l info
        ;;
    beat)
        exec celery -A config beat -l info
        ;;
    *)
        exec "$@"
        ;;
esac
