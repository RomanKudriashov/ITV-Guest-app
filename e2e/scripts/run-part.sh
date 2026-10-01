#!/bin/zsh
# Прогон одной части (партия 25):
#   scripts/run-part.sh part-A.txt [логи]
# 1) перезапуск стека проекта (с профилем grms) и ожидание backend/frontend;
# 2) два захода подряд; перед каждым — уборка остатков (--stale-hours 3);
# 3) первая красная — стоп: дальше диагноз, а не повтор наугад.
set -u
LIST=$1
LOGS=${2:-/tmp}
HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$HERE/.." && pwd)
NAME=$(basename "$LIST" .txt)
cd "$ROOT"
docker compose --profile grms restart >/dev/null 2>&1
for i in $(seq 1 60); do
  b=$(curl -s -m 5 -o /dev/null -w "%{http_code}" localhost:8010/api/health)
  f=$(curl -s -m 5 -o /dev/null -w "%{http_code}" localhost:5183/)
  [ "$b" = "200" ] && [ "$f" = "200" ] && break
  sleep 2
done
echo "$NAME: стек перезапущен (backend $b, frontend $f) @ $(date +%H:%M)"
for run in 1 2; do
  docker compose exec -T backend python manage.py clean_test_residue --stale-hours 3 --apply >/dev/null 2>&1
  (cd "$HERE" && npx playwright test $(tr '\n' ' ' < "$LIST") --reporter=line --trace=off > "$LOGS/$NAME-run$run.txt" 2>&1)
  echo "$NAME run $run: $(grep -E '^\s+[0-9]+ (passed|failed|flaky)' "$LOGS/$NAME-run$run.txt" | tr -s ' ' | tr '\n' ' ') @ $(date +%H:%M)"
  grep -qE '^\s+[0-9]+ failed' "$LOGS/$NAME-run$run.txt" && { echo "$NAME: КРАСНАЯ в заходе $run — стоп, диагноз"; exit 1; }
done
echo "$NAME: ДВА ЗАХОДА ЧИСТЫЕ"
