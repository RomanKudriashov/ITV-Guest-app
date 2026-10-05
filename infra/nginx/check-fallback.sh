#!/usr/bin/env bash
# Сторож запасного маршрута SPA (партия 30, п.62 бэклога).
#
# Поднимает настоящий nginx того же образа, что в проде, с НАСТОЯЩИМ
# app.locations.conf и игрушечной статикой, и спрашивает адреса: экран обязан
# получить витрину, отсутствующий файл — 404. Upstream'ы указывают в никуда —
# API здесь не проверяется, nginx лишь должен подняться.
#
#   bash infra/nginx/check-fallback.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
name="itv-nginx-fallback-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

mkdir -p "$work/html/assets" "$work/html/fonts"
echo '<!doctype html><title>витрина</title>' > "$work/html/index.html"
echo 'console.log(1)' > "$work/html/assets/app.js"
cat > "$work/server.conf" <<'CONF'
upstream backend { server 127.0.0.1:9; }
upstream minio { server 127.0.0.1:9; }
server {
    listen 80;
    include /etc/nginx/app.locations.conf;
}
CONF

docker run -d --name "$name" -p 127.0.0.1::80 \
  -v "$work/server.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$here/app.locations.conf:/etc/nginx/app.locations.conf:ro" \
  -v "$work/html:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null
port="$(docker port "$name" 80 | head -1 | sed 's/.*://')"
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done

fail=0
check() {  # путь, ожидаемый код, витрина ли в теле (yes/no)
  local body code
  body="$(curl -s -w '\n%{http_code}' "http://127.0.0.1:$port$1")"
  code="${body##*$'\n'}"
  if [[ "$code" != "$2" ]]; then echo "КРАСНОЕ $1: $code, ждали $2"; fail=1; return; fi
  if [[ "$3" == yes && "$body" != *витрина* ]]; then echo "КРАСНОЕ $1: нет витрины"; fail=1; return; fi
  if [[ "$3" == no && "$body" == *витрина* ]]; then echo "КРАСНОЕ $1: отдана витрина"; fail=1; return; fi
  echo "ок $1 → $code"
}
# Экраны — витрина.
check / 200 yes
check /home 200 yes
check /cms/services/3f0c 200 yes
check /tracker/order/abc 200 yes
check /r/1.05 200 yes
# Существующие файлы — как есть.
check /assets/app.js 200 no
# Отсутствующее — 404, а не витрина.
check /static/placeholders/default.svg 404 no
check /assets/gone-123.js 404 no
check /fonts/missing.woff2 404 no
check /media/photo.jpg 404 no
check /landing/hero.webp 404 no
check /favicon.ico 404 no
check /cms/logo.png 404 no
# Кэш (партия 31, ADM-002): сборка с хэшем — надолго, оболочка — без кэша.
header() { curl -s -D - -o /dev/null "http://127.0.0.1:$port$1" | tr -d '\r' | grep -i '^cache-control:' | cut -d' ' -f2-; }
if [[ "$(header /assets/app.js)" != *immutable* ]]; then echo "КРАСНОЕ /assets/app.js: нет долгого кэша ($(header /assets/app.js))"; fail=1; else echo "ок /assets/app.js → кэш надолго"; fi
for screen in / /home; do
  if [[ "$(header $screen)" != *no-cache* ]]; then echo "КРАСНОЕ $screen: оболочка кэшируется ($(header $screen))"; fail=1; else echo "ок $screen → без кэша"; fi
done
exit $fail
