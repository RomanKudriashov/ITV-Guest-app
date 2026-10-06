#!/bin/sh
# Выпуск сертификата и включение HTTPS на стенде (партия 39: несколько баз).
#
# Wildcard на этих доменах не выпустить, и он не нужен: сертификат выписывается
# на СПИСОК имён — каждая база (`APP_DOMAINS`) и каждый действующий отель под
# каждой базой. Список НЕ пишется здесь: его отдаёт `manage.py tls_names` из
# базы отелей, новый отель попадает в него сам — скрипт достаточно прогнать.
#
# Имя, которое не указывает на этот сервер (записи DNS ещё нет), ПРОПУСКАЕТСЯ с
# предупреждением: одно незаведённое имя не должно валить перевыпуск всем.
#
# Идемпотентен: certbot сам решит, перевыпускать или нет, а конфигурация
# просто перекладывается заново.
#
#   ./infra/nginx/enable-tls.sh [почта]      # из корня репозитория на стенде
#   DRY_RUN=1 ./infra/nginx/enable-tls.sh    # проверка на тестовом сервере LE: ничего не меняет
set -eu

EMAIL="${1:-79263820654@yandex.ru}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# Имена — из базы отелей. NAMES можно подать руками (проверка скрипта).
if [ -z "${NAMES:-}" ]; then
    NAMES="$(cd "$ROOT" && docker compose -f docker-compose.prod.yml --env-file .env.prod \
        exec -T backend python manage.py tls_names 2>/dev/null | grep -E '^[a-z0-9.-]+$')"
fi
[ -n "$NAMES" ] || { echo "manage.py tls_names не дал ни одного имени — стоп"; exit 1; }

# Адреса этого сервера: имя годится, если указывает на один из них.
MINE="$(hostname -I 2>/dev/null || true) ${STAND_IP:-}"

ARGS=""
TAKEN=0
SKIPPED=0
for name in $NAMES; do
    resolved="$(getent ahostsv4 "$name" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
    ok=""
    for ip in $resolved; do
        case " $MINE " in *" $ip "*) ok=1 ;; esac
    done
    if [ -n "$ok" ]; then
        ARGS="$ARGS -d $name"
        TAKEN=$((TAKEN + 1))
    else
        echo "ПРОПУСК $name: указывает на «${resolved:-ничего}», а не на этот сервер — нужна запись DNS"
        SKIPPED=$((SKIPPED + 1))
    fi
done
[ "$TAKEN" -gt 0 ] || { echo "ни одно имя не указывает на сервер — стоп"; exit 1; }
echo "в сертификат: $TAKEN имён, пропущено: $SKIPPED"

mkdir -p /var/www/certbot "$HERE/live"

if [ -n "${DRY_RUN:-}" ]; then
    # Холостой выпуск: тестовый сервер LE, сертификат и конфигурация не меняются.
    # shellcheck disable=SC2086
    certbot certonly --webroot -w /var/www/certbot --dry-run \
        --non-interactive --agree-tos --email "$EMAIL" --cert-name stand $ARGS
    echo "Холостой выпуск прошёл — боевой: без DRY_RUN."
    exit 0
fi

# Почта учётной записи — на ней письма об истечении. Прежняя учётка заведена
# без почты (--register-unsafely-without-email): обновляем, не перерегистрируя.
certbot update_account --non-interactive --email "$EMAIL" --no-eff-email >/dev/null 2>&1 || true

# webroot, а не standalone: nginx остаётся ПОДНЯТЫМ. Гасить его ради продления
# значит ронять стенд каждые три месяца.
# shellcheck disable=SC2086
certbot certonly --webroot -w /var/www/certbot \
    --non-interactive --agree-tos --email "$EMAIL" \
    --cert-name stand $ARGS

sed 's/STAND_CERT/stand/g' "$HERE/tls.enabled.conf.template" > "$HERE/live/tls.enabled.conf"
cp "$HERE/redirect-to-https.conf.template" "$HERE/live/redirect-to-https.conf"
# Гасим приложение на 80-м: два `location /` в одном server-блоке — отказ старта.
rm -f "$HERE/live/http-app.off.conf"

echo "Сертификат выпущен. Перезапустите nginx: docker compose -f docker-compose.prod.yml restart nginx"
