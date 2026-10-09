#!/bin/sh
# Проверка почты учётки в enable-tls.sh (п.9, партия 51) — без root и без LE.
#
#   sh infra/nginx/test-enable-tls.sh [путь к проверяемому скрипту]
#
# Гонять на Linux: скрипт стенда резолвит имена через `getent`, которого нет на
# macOS. С машины разработчика — в образе бэкенда (Debian):
#   docker run --rm -v "$PWD/infra:/infra" --entrypoint sh itv-guest-app-backend \
#       /infra/nginx/test-enable-tls.sh
#
# certbot подменён заглушкой в PATH: пишет свои аргументы в журнал и отказывает
# в update_account, если задано CERTBOT_REFUSE_ACCOUNT. Скрипт гоняется КОПИЕЙ во
# временной папке — живая `infra/nginx/live/` не трогается.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
UNDER_TEST="${1:-$HERE/enable-tls.sh}"
FAILED=0

run_case() {
    # $1 — имя случая; дальше — переменные окружения прогона
    name="$1"; shift
    work="$(mktemp -d)"
    mkdir -p "$work/bin" "$work/nginx"
    cp "$UNDER_TEST" "$work/nginx/enable-tls.sh"
    cp "$HERE/tls.enabled.conf.template" "$HERE/redirect-to-https.conf.template" "$work/nginx/"
    cat > "$work/bin/certbot" <<'STUB'
#!/bin/sh
echo "certbot $*" >> "$CERTBOT_LOG"
if [ "$1" = "update_account" ] && [ -n "${CERTBOT_REFUSE_ACCOUNT:-}" ]; then exit 1; fi
exit 0
STUB
    chmod +x "$work/bin/certbot"
    out="$(env PATH="$work/bin:$PATH" CERTBOT_LOG="$work/certbot.log" NAMES=localhost STAND_IP=127.0.0.1 \
        WEBROOT="$work/webroot" "$@" sh "$work/nginx/enable-tls.sh" 2>&1)"
    code=$?
    log="$(cat "$work/certbot.log" 2>/dev/null || true)"
    rm -rf "$work"
}

check() {
    # $1 — условие (0/1), $2 — что проверяли
    if [ "$1" -eq 0 ]; then echo "  ok   $2"; else echo "  FAIL $2"; FAILED=1; fi
}

echo "1. LE_EMAIL пуст — громко и без почты, выпуск идёт"
run_case empty LE_EMAIL=
check "$code" "код выхода 0 (было $code)"
echo "$out" | grep -q "LE_EMAIL не задан"; check $? "предупреждение напечатано"
echo "$log" | grep -q "certonly.*--register-unsafely-without-email"; check $? "certonly без почты"
echo "$log" | grep -q "update_account"; [ $? -ne 0 ]; check $? "update_account не вызывался"

echo "2. LE_EMAIL задан и принят — почта в учётке и в выпуске"
run_case accepted LE_EMAIL=ops@example.test
check "$code" "код выхода 0 (было $code)"
echo "$log" | grep -q "update_account .*--email ops@example.test"; check $? "update_account с почтой"
echo "$log" | grep -q "certonly.*--email ops@example.test"; check $? "certonly с почтой"

echo "3. LE_EMAIL задан, LE отказал — ошибка, выпуска нет"
run_case refused LE_EMAIL=ops@example.test CERTBOT_REFUSE_ACCOUNT=1
[ "$code" -ne 0 ]; check $? "код выхода не 0 (было $code)"
echo "$out" | grep -q "не принял почту"; check $? "ошибка названа"
echo "$log" | grep -q "certonly"; [ $? -ne 0 ]; check $? "certonly не вызывался"

echo "4. личной почты по умолчанию в скрипте нет"
grep -qE "[0-9]{6,}@|@yandex\." "$UNDER_TEST"; [ $? -ne 0 ]; check $? "адреса в тексте скрипта нет"

[ "$FAILED" -eq 0 ] && echo "ВСЁ ЗЕЛЁНОЕ" || { echo "ЕСТЬ КРАСНЫЕ"; exit 1; }
