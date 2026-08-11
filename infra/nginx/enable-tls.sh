#!/bin/sh
# Выпуск сертификата и включение HTTPS на стенде.
#
# Wildcard на sslip.io не выпустить, и он не нужен: сертификат выписывается на
# СПИСОК имён — базовый домен плюс по одному на отель. Добавился отель — имя
# сюда, и скрипт прогнать заново.
#
# Идемпотентен: certbot сам решит, продлевать или нет, а конфигурация просто
# перекладывается заново.
#
#   ./infra/nginx/enable-tls.sh admin@example.com
set -eu

EMAIL="${1:?укажите почту для Let's Encrypt}"
BASE="${APP_DOMAIN:-app.147.45.245.172.sslip.io}"
DOMAINS="$BASE crystal.$BASE azure.$BASE lumen.$BASE"
HERE="$(cd "$(dirname "$0")" && pwd)"

ARGS=""
for d in $DOMAINS; do ARGS="$ARGS -d $d"; done

mkdir -p /var/www/certbot "$HERE/live"

# webroot, а не standalone: nginx остаётся ПОДНЯТЫМ. Гасить его ради продления
# значит ронять стенд каждые три месяца.
certbot certonly --webroot -w /var/www/certbot \
    --non-interactive --agree-tos --email "$EMAIL" \
    --cert-name stand $ARGS

sed 's/STAND_CERT/stand/g' "$HERE/tls.enabled.conf.template" > "$HERE/live/tls.enabled.conf"
cp "$HERE/redirect-to-https.conf.template" "$HERE/live/redirect-to-https.conf"
# Гасим приложение на 80-м: два `location /` в одном server-блоке — отказ старта.
rm -f "$HERE/live/http-app.off.conf"

echo "Сертификат выпущен. Перезапустите nginx: docker compose -f docker-compose.prod.yml restart nginx"
