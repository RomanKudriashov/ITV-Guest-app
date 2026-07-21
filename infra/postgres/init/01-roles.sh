#!/bin/sh
# ---------------------------------------------------------------------------
# Три роли — краеугольный камень мультитенантности.
#
#   POSTGRES_USER (postgres)  — bootstrap-суперпользователь образа. Только для
#                               инициализации и обслуживания. Приложение под
#                               ним НЕ работает: суперпользователь ИГНОРИРУЕТ
#                               RLS, и вся изоляция превратилась бы в фикцию.
#
#   $APP_USER                 — роль приложения. Обычная, без BYPASSRLS.
#                               Под ней работают backend и worker в рантайме.
#                               Забыл фильтр по hotel_id — Postgres всё равно
#                               не отдаст чужие строки (политики создаёт
#                               миграция apps/core/0002_rls).
#
#   $PLATFORM_USER            — платформенная роль с BYPASSRLS. Миграции и
#                               кросс-отельный платформенный уровень. Никогда
#                               не обслуживает гостевые запросы.
#
# Исполняется docker-entrypoint'ом postgres ОДИН РАЗ при инициализации пустого
# кластера. Пересоздать: docker compose down -v && docker compose up.
# ---------------------------------------------------------------------------
set -eu

APP_USER="${APP_DB_USER:-guestapp}"
APP_PASSWORD="${APP_DB_PASSWORD:-guestapp}"
PLATFORM_USER="${PLATFORM_DB_USER:-guestapp_platform}"
PLATFORM_PASSWORD="${PLATFORM_DB_PASSWORD:-guestapp_platform}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- CREATEDB нужен обеим ролям: без него pytest-django не создаст тестовую БД.
    CREATE ROLE "$APP_USER"      LOGIN PASSWORD '$APP_PASSWORD' NOSUPERUSER NOBYPASSRLS CREATEDB;
    CREATE ROLE "$PLATFORM_USER" LOGIN PASSWORD '$PLATFORM_PASSWORD' NOSUPERUSER BYPASSRLS CREATEDB;

    GRANT ALL PRIVILEGES ON DATABASE "$POSTGRES_DB" TO "$APP_USER", "$PLATFORM_USER";

    -- Платформенная роль должна видеть объекты, созданные ролью приложения,
    -- и наоборот: обе работают в одной схеме public.
    GRANT "$APP_USER" TO "$PLATFORM_USER";
    GRANT ALL ON SCHEMA public TO "$APP_USER", "$PLATFORM_USER";

    ALTER DEFAULT PRIVILEGES FOR ROLE "$APP_USER" IN SCHEMA public
        GRANT ALL ON TABLES TO "$PLATFORM_USER";
    ALTER DEFAULT PRIVILEGES FOR ROLE "$APP_USER" IN SCHEMA public
        GRANT ALL ON SEQUENCES TO "$PLATFORM_USER";
    ALTER DEFAULT PRIVILEGES FOR ROLE "$PLATFORM_USER" IN SCHEMA public
        GRANT ALL ON TABLES TO "$APP_USER";
    ALTER DEFAULT PRIVILEGES FOR ROLE "$PLATFORM_USER" IN SCHEMA public
        GRANT ALL ON SEQUENCES TO "$APP_USER";
EOSQL

echo "[init] roles ready: $APP_USER (подчиняется RLS), $PLATFORM_USER (BYPASSRLS)"
