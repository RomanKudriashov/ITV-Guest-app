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
            echo "[entrypoint] seed_demo_hotel…"
            python manage.py seed_demo_hotel --with-guest-history || echo "[entrypoint] сид пропущен (уже есть?)"
        fi

        echo "[entrypoint] uvicorn (ASGI: HTTP + WebSocket)…"
        exec uvicorn config.asgi:application \
            --host 0.0.0.0 --port 8000 \
            --reload --reload-dir /app
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
