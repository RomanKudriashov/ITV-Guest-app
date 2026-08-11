#!/bin/sh
# Вернуть стенд в режим «без TLS»: приложение на 80-м, редиректа нет.
# Нужен ровно один раз — при первом подъёме, до выпуска сертификата.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/live"
cp "$HERE/http-app.on.conf" "$HERE/live/http-app.off.conf"
rm -f "$HERE/live/tls.enabled.conf" "$HERE/live/redirect-to-https.conf"
echo "Режим HTTP. Перезапустите nginx."
