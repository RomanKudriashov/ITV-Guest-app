# ITV Guest App

Мультиотельная гостевая платформа: гость сканирует QR в номере, со своего
телефона смотрит меню и услуги отеля и заказывает; персонал ведёт заявки в
трекере; отель управляет каталогом и оформлением.

Один движок на все отели — отличаются только данные и тумблеры.

> **Статус: фундамент.** В этом прогоне собран каркас, на который дальше
> ложатся вертикальные срезы. UI (CMS, витрина гостя, трекер) НЕ реализован —
> есть только фундамент, модель данных еды, сид демо-отеля и дымовые
> эндпоинты, доказывающие, что фундамент работает.

---

## Быстрый старт

```bash
cp .env.example .env
docker compose up
```

Поднимутся: `postgres`, `redis`, `minio`, `backend` (ASGI: HTTP + WebSocket),
`worker` (Celery), `frontend` (Vite dev). Backend сам прогонит миграции и
наполнит демо-отель.

| Сервис | Адрес | Заметка |
|---|---|---|
| API | http://localhost:8010/api/ | порт меняется `BACKEND_HOST_PORT` |
| Swagger | http://localhost:8010/api/docs | |
| Health | http://localhost:8010/api/health | проверяет БД, Redis, MinIO |
| Frontend | http://localhost:5183/ | демо темы/i18n/RTL |
| MinIO-консоль | http://localhost:59001/ | `minioadmin` / `minioadmin` |
| Postgres | `localhost:55432` | |

Порты на хосте нестандартные намеренно — чтобы стенд не дрался за 5432/6379/9000
с другими проектами на той же машине. Меняются в `.env`.

### Как попасть в конкретный отель

Отель определяется **поддоменом**: `crystal.guest.localhost`. Локально это
работает без правки `/etc/hosts` — всё, что оканчивается на `.localhost`,
резолвится в 127.0.0.1 (macOS, Linux, современные браузеры). Через curl —
заголовком `Host`:

```bash
curl -H "Host: crystal.guest.localhost" http://localhost:8010/api/guest/menu
```

В деве (`DJANGO_DEBUG=1`) дополнительно принимаются `X-Hotel-Subdomain: crystal`
и `?hotel=crystal`. В проде оба отключены.

### Дымовой сценарий целиком

```bash
H="Host: crystal.guest.localhost"
BASE=http://localhost:8010/api/guest

# 1. Сессия по номеру комнаты
TOKEN=$(curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"room_number":"305"}' $BASE/session | jq -r .token)

# 2. Меню — локализованное, с учётом расписания
curl -s -H "$H" -H "Authorization: Bearer $TOKEN" -H "Accept-Language: en" $BASE/menu | jq

# 3. Заказ — идемпотентный
curl -s -X POST -H "$H" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Idempotency-Key: demo-1" \
  -d '{"lines":[{"item_id":"<id>","quantity":2,"modifier_option_ids":["<id>"]}]}' \
  $BASE/order | jq

# 4. Статус
curl -s -H "$H" -H "Authorization: Bearer $TOKEN" $BASE/order/<order_id> | jq
```

### Тесты

```bash
docker compose run --rm --entrypoint pytest backend -q
```

Обязательные для фундамента: изоляция тенантов (`test_tenant_isolation.py`),
идемпотентность (`test_idempotency.py`), покрытие RLS (`test_rls_coverage.py`).

---

## Структура

```
backend/
  config/            настройки, ASGI/WSGI, Celery
  api/               django-ninja: гостевые эндпоинты, health
  apps/
    core/            базовые модели, мультитенантность, RLS, идемпотентность, аудит
    hotels/          отель, бренд, языки, номера, точки исполнения, локации, расписания
    accounts/        персонал, назначения, гостевые сессии, токены, impersonation
    catalog/         категории, позиции, модификаторы, маршруты, матрица локаций
    orders/          заказы, позиции, статусы, история переходов
    media/           MinIO, варианты через Celery, заглушки по категориям
    events/          событийная шина + подписчики (трекер, аналитика, аудит)
    realtime/        WebSocket-консьюмеры (Channels)
    integrations/    швы PMS и оплаты — интерфейсы + адаптеры «нет»
  tests/
frontend/            React 18 + MUI v6 + Vite: тема из токенов, i18n, RTL
infra/postgres/init/ создание ролей БД
```

---

## Что уже стоит в фундаменте

### 1. Мультитенантность — эшелонированная

Три независимых рубежа, потому что цена ошибки — данные чужого отеля.

**Резолюция.** `TenantMiddleware` достаёт поддомен из `Host`, находит отель и
кладёт его в контекст запроса (`apps/core/context.py`) — и в питон-contextvar,
и в сессионную переменную Postgres `app.current_hotel`.

**ORM.** `TenantModel.objects` — это `TenantManager`, который сам добавляет
фильтр по текущему отелю. Прикладной код фильтр по `hotel_id` **не пишет**.
Поведение fail-closed: вне контекста отеля запрос вернёт пусто, а не чужое.

**Postgres RLS.** На каждой тенант-таблице политика
`hotel_id::text = current_setting('app.current_hotel', true)` плюс
`FORCE ROW LEVEL SECURITY`. Это страховка от того, что пройдёт мимо менеджера:
raw SQL, `.all_objects`, невнимательный related-запрос.

Три роли БД (`infra/postgres/init/01-roles.sh`):

| Роль | Назначение |
|---|---|
| `postgres` | bootstrap-суперпользователь образа. Только инициализация. **Приложение под ним не работает — суперпользователь игнорирует RLS.** |
| `guestapp` | роль приложения. Обычная, без BYPASSRLS. Под ней backend и worker. |
| `guestapp_platform` | платформенная, BYPASSRLS. Миграции и кросс-отельный уровень. |

Поэтому миграции гоняются платформенной ролью:

```bash
docker compose run --rm --entrypoint python backend manage.py migrate --database=platform
```

Выйти за пределы одного отеля можно только осознанно: `platform_scope()` снимает
фильтр ORM, но RLS остаётся — читать кросс-отельно получится лишь через
`.using("platform")`. Двойной замок сделан нарочно: случайно так не напишешь.

Новая тенант-таблица → имя в `apps/core/tenant_tables.py` + миграция с
`rls.enable_sql([...])`. Забыть нельзя: `test_rls_coverage.py` находит все
модели с `hotel` и падает, если таблицы нет в списке.

### 2. Базовый класс моделей

`BaseModel`: UUID-pk, `created_at/updated_at/created_by`, soft-delete
(в том числе при массовом `.delete()`), помощник переводимых полей.
`TenantModel` добавляет `hotel_id` и автоскоуп.

Переводимые поля — единая схема, `TranslatableField` (JSONB `{lang: value}`):

```python
item.title          # {"ru": "Стейк рибай", "en": "Ribeye steak"}  — для CMS
item.title_i18n     # строка на языке текущего запроса
item.tr("title", "ar")
```

Фолбэк: запрошенный язык → язык отеля → `en` → любое непустое. Недопереведённый
контент не роняет выдачу меню гостю.

`created_by` — UUID, а не FK: иначе core зависел бы от accounts, а accounts от
hotels, и получился бы цикл миграций. Жёсткая трассировка действий — в `AuditLog`.

### 3. Аутентификация

| Субъект | Механизм |
|---|---|
| Персонал | JWT (HS256), stateless, с `hotel` и списком точек исполнения |
| Гость | непрозрачный отзываемый токен; в БД только SHA-256 |
| Платформа | JWT со `scope=platform`, чтение через платформенное подключение |

У гостевой сессии есть **уровень доверия** (`trust`):
`anonymous < room_scanned < pms_verified < staff_verified`. Права зависят от
него, а не от факта наличия токена: смотреть меню можно анонимно, писать на
счёт номера — только подтверждённому по PMS.

Аутентификация никогда не выбирает тенанта: тенант уже выбран поддоменом,
токен обязан ему соответствовать.

Impersonation заложен каркасно: грант в БД, клейм `imp` в токене, запись в
аудит. Действие поддержки от имени сотрудника остаётся отличимым от действия
самого сотрудника.

### 4. Событийная шина и realtime

`apps/events/bus.py`. События: `order.created`, `order.status_changed`,
`order.cancelled`. Подписчики (каркас): канал трекера по WebSocket, счётчики
аналитики в Redis, аудит.

Два правила, ради которых шина и написана:

1. **Эмит после коммита** (`transaction.on_commit`). Иначе подписчик увидит
   заказ, которого в базе ещё нет, — а при откате не будет никогда. То же
   правило распространено на диспатч Celery-задач.
2. **Падение подписчика не роняет операцию.** Заказ создан; несработавший
   счётчик — не повод отдавать гостю 500.

WebSocket: `/ws/tracker/` (доска точки исполнения) и `/ws/order/<id>/` (гость
следит за своим заказом).

### 5. Идемпотентность и транзакции

`POST /api/guest/order` требует заголовок `Idempotency-Key`. Повтор с тем же
ключом и тем же телом отдаёт **тот же** заказ (200 вместо 201); тот же ключ с
другим телом — 409. Гонка одновременных запросов разрешается уникальным
индексом в БД, а не блокировкой в питоне.

Заказ, позиции и резолв маршрута создаются в одной транзакции; событие уходит
после коммита.

### 6. Медиапайплайн

Загрузка → оригинал в MinIO → Celery режет варианты (`thumb`/`card`/`full`,
WebP, с учётом EXIF-поворота) → фолбэк на заглушку по категории. API никогда не
ждёт обработки: ассет отдаётся в статусе `pending`.

### 7. Фронтенд-каркас

Тема MUI собирается **только из токенов бренда** (`frontend/src/theme/tokens.ts`),
светлая/тёмная, RTL через `stylis-plugin-rtl` с переключением emotion-cache.
i18n: ru/en/ar/zh, автоопределение языка устройства, фолбэк `en`.

**Правило проекта: ни одного захардкоженного цвета вне `tokens.ts`.** Формат
токенов совпадает с `BrandTheme.tokens` на бэкенде — это один контракт, а не
две похожие структуры.

---

## Модель данных (срез «еда»)

`Hotel` · `BrandTheme` · `HotelLanguage` · `Room` · `ExecutionPoint` ·
`Location` · `Schedule`+`ScheduleInterval` — отель и его структура.
`User`+`StaffAssignment` · `GuestSession` — доступ.
`Category` (дерево) · `Item` · `ModifierGroup`+`ModifierOption` · `Route` ·
`ServiceLocation` — каталог.
`Order`+`OrderItem` · `StatusDefinition` · `OrderStatusChange` — заказы.
`MediaAsset` · `CategoryPlaceholder` · `AuditLog` · `IdempotencyKey`.

Два сквозных решения:

* **Цены — в минимальных единицах** (копейках), целыми. Никакого float и
  никаких сюрпризов округления.
* **Время — в UTC, расписания — в таймзоне отеля.** «Кухня до 23:00» означает
  23:00 у отеля, а не на сервере.

`Category` и `Item` уже имеют поле `type`. Еда — это `type=product`; SPA,
экскурсии и трансфер лягут в те же таблицы, а не в параллельную иерархию.

Заказ хранит **снапшоты**: цену, название и модификаторы на момент заказа, и
резолвленную точку исполнения. Меню меняется каждый день — история заказа
меняться не должна.

---

## Сид демо-отеля

```bash
docker compose run --rm --entrypoint python backend \
  manage.py seed_demo_hotel --with-second-hotel
```

Создаёт отель «Кристалл» (`crystal`): бренд-токены, языки ru/en/ar/zh, кухню и
лобби-бар как точки исполнения, повара с назначением, категории Горячее /
Салаты / Напитки с блюдами (фото, флаги, аллергены), у стейка — обязательную
группу «Прожарка» и необязательные «Добавки», 9 номеров, локации «в номер» и
«у бассейна» (с уточнением «номер шезлонга»), расписания и пресет статусов
`new → accepted → preparing → on_the_way → done/cancelled`.

Команда идемпотентна. `--with-second-hotel` добавляет `aurora` — на нём удобно
проверять изоляцию руками.

---

## Что НЕ сделано в этом прогоне

* Экраны CMS, витрины гостя и трекера — следующие прогоны.
* Полный набор эндпоинтов и функциональный WS-трекер (действия, назначение, SLA).
* Оплата и PMS — только интерфейсы и адаптеры «нет» (`apps/integrations/`).
* Умный номер, цифровой ключ, Go Green, отзывы, аналитические витрины.

## Полезные команды

```bash
docker compose logs -f backend worker            # логи
docker compose run --rm --entrypoint pytest backend -q
docker compose run --rm --entrypoint python backend manage.py makemigrations
docker compose run --rm --entrypoint python backend manage.py migrate --database=platform
docker compose down -v                            # снести данные и роли БД
```

Платформенного супер-админа заводить платформенной ролью — у него `hotel=NULL`,
и роль приложения такую строку не видит по RLS:

```bash
docker compose run --rm --entrypoint python backend \
  manage.py createsuperuser --database=platform
```
