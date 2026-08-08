# Раскладка бэкенда: разбор эталона и план переноса

Прогон АНАЛИЗА. Ни строки кода, миграций, сидов и тестов не тронуто — здесь только разбор,
целевая раскладка и план. Эталон: `/Users/olegpronkin/apl/aplodesk-back` (читается из сессии,
Django 4.2 + django-ninja, как и у нас).

---

## 1. Эталон

### Дерево

```
app/
├── api.py                 ← ЕДИНСТВЕННАЯ точка сборки: собирает роутеры приложений
├── config/                ← settings, urls
├── core/                  ← общее: базовые схемы, пагинация, права, исключения, миксины моделей
├── issues/                ← домен «заявки», самое крупное приложение
├── users/  clients/  service_entities/  attachments/  knowledge_base/
├── notifications/  checklist_libs/
└── tests/                 ← тесты ВСЕГО проекта, зеркалят структуру приложений
```

### Слои внутри приложения

```
issues/
├── models/          issue.py, comment.py, status.py, priority.py, checklist.py…
├── schemas/         issue.py, comments.py, status.py…            (Pydantic in/out)
├── api/             router.py + issues.py, comments.py, status.py, checklists.py…
├── services/        issues/{create,detail,list,delete,change_status,merge,assign_me…}.py
│                    comments/, histories/, email/, suggestions/
├── permissions/     классы прав под сложные случаи
├── tasks/           фоновые задачи
├── management/      команды
├── migrations/
└── exceptions.py    доменные исключения
```

### Как режутся эндпоинты

По **ресурсу**, а не по роли зовущего и не по «экрану» клиента: `issues.py`, `comments.py`,
`status.py`, `priority.py`, `checklists.py`. Роутеры собираются снизу вверх:
файл ресурса → `issues/api/router.py` → `app/api.py` (`apps_api.add_router("/issues/", …)`).

### Границы слоёв

Замерено, а не на глаз — строки кода в приложении `issues`:

| слой | строк |
|---|---|
| services | **3596** |
| api | 440 |
| models | 440 |
| schemas | 430 |
| permissions | 136 |
| tasks | 50 |

**Восемь строк логики на одну строку эндпоинта.** Вьюха в эталоне — три строки: разобрать
запрос, позвать сервис, вернуть. ORM во вьюхах нет. Сервис не знает про HTTP: принимает схему
и идентификаторы, возвращает модель или схему, бросает доменное исключение
(`core.exceptions.ValidationError` → 400, `PermissionDeniedError` → 403), а не `HttpResponse`.

Один класс сервиса — **одна операция**: `IssueCreateService`, `IssueAssignMeService`,
`IssueChangeStatusService`. Общее для группы операций живёт в `services/issues/common.py`.

Тесты зеркалят: `tests/{app}/api/test_*.py` (мокают сервис, проверяют код ответа и права),
`tests/{app}/services/test_*.py` (логика), `tests/{app}/factories/`.

### ПРАВИЛО эталона

> Приложение — это домен, и всё про него лежит внутри него: модели, схемы, права, задачи,
> команды, эндпоинты и бизнес-логика. Эндпоинт тонкий: разобрал запрос, позвал сервис одной
> операции, вернул схему; вся логика — в сервисе, ORM во вьюхе не появляется, а сервис ничего
> не знает про HTTP. Файлы эндпоинтов режутся по РЕСУРСУ, а не по роли зовущего, и собираются
> снизу вверх в единственную точку сборки. Слой не заглядывает через голову соседнему: вниз по
> стопке ходить можно, вверх — нет.

По этому правилу дальше и проверяется наш перенос.

---

## 2. Наш проект

### Текущее дерево

```
backend/
├── api/                   ← ВСЕ эндпоинты продукта, 4968 строк, вне приложений
│   ├── guest.py           13 эндпоинтов, 414 строк
│   ├── guest_room.py      3 / 92
│   ├── chat_reviews.py    12 / 188      ← здесь же ГЛАВНАЯ гостя и поиск
│   ├── orders.py, staff.py, tracker.py, platform.py (38 / 982), onprem.py, health.py
│   ├── schemas.py         14 схем
│   └── cms/               catalog.py (55 / 683), hotel_admin.py (25 / 310), grms.py (21 / 665),
│                          analytics.py, notifications.py, brand.py, common.py, inclusions.py,
│                          reviews.py, schemas.py (35 схем)
├── apps/                  ← модели + логика, ПЛОСКИМ списком файлов в корне приложения
│   ├── hotels/            25 файлов в корне, 9869 строк
│   ├── grms/              22 файла, 6126
│   ├── catalog/           14 файлов, 5281
│   ├── orders/ 2818, analytics/ 2019, core/ 1640, notifications/ 1372, accounts/ 1476,
│   ├── media/ 860, realtime/ 600, events/ 519, integrations/ 475, chat/ 319, reviews/ 200
├── config/                settings, urls, asgi, celery
└── tests/                 75 файлов ПЛОСКИМ списком: test_*.py по темам
```

### Где раскладка разъехалась — конкретно

1. **Эндпоинты живут отдельно от домена.** `api/` — параллельное дерево: логика в
   `apps/catalog/`, а вьюхи к ней в `api/guest.py` и `api/cms/catalog.py`. Домен нельзя
   прочитать целиком, не открыв два дерева.

2. **Гостевые эндпоинты разложены по трём файлам без общего признака.** `api/guest.py`
   (каталог, позиция, слоты, корзина, заказы), `api/guest_room.py` (управление номером),
   `api/chat_reviews.py` (чат, отзывы — и, внезапно, **главная витрины и глобальный поиск**).
   Последнее — прямое следствие того, что файл режется не по ресурсу: главную дописали туда,
   где оказался свободный роутер.

3. **CMS режется по ролям и экранам, а не по ресурсам.** `api/cms/catalog.py` — 55 эндпоинтов
   в одном файле: категории, позиции, модификаторы, быстрые действия, настройки главной,
   настройки поиска, плитки витрины. `api/cms/hotel_admin.py` — 25 эндпоинтов: номера, локации,
   сервисы, расписания.

4. **GRMS размазан по трём местам.** Модели и логика — `apps/grms/` (22 файла плоско:
   `commands.py`, `transport.py`, `publishing.py`, `plan.py`, `pin.py`, `reconcile.py`…),
   гостевые эндпоинты — `api/guest_room.py`, CMS-эндпоинты — `api/cms/grms.py`,
   WS-консьюмеры — `apps/grms/consumers.py` при роутинге в `apps/realtime/routing.py`.

5. **Внутри приложения слоёв нет.** `apps/hotels/` держит в одном плоском списке модели
   (`models.py`, 1000+ строк), сервисы CMS (`admin_services.py`), платформенные вьюхи-сервисы
   (`platform_fleet.py`, `platform_usage.py`, `platform_overview.py`, `platform_team.py`),
   онбординг, оффбординг, тарифы, бренд (4 файла), провижининг, QR, словари.
   `apps/catalog/` — так же: `services.py`, `cms_services.py`, `showcase.py`, `home.py`,
   `search.py`, `slots.py`, `availability.py`, `inclusions.py`.

6. **Схемы в трёх местах:** `api/schemas.py` (14), `api/cms/schemas.py` (35) и **прямо во
   вьюхах**: `api/platform.py` — 17 классов, `api/cms/hotel_admin.py` — 14,
   `api/cms/catalog.py` — 13, `api/cms/grms.py` — 12.

7. **ORM прямо во вьюхах** — восемь файлов: `api/staff.py`, `api/guest.py`, `api/platform.py`,
   `api/cms/{catalog,analytics,grms,common,reviews}.py`.

8. **Тесты плоские.** 75 файлов `tests/test_*.py` по темам, без деления на api/services и без
   привязки к приложению.

### Что уже совпадает с эталоном — не трогаем

- **Домены выделены правильно.** `hotels`, `catalog`, `orders`, `grms`, `chat`, `analytics`,
  `notifications`, `media`, `accounts` — это те же «домены», что `issues`/`clients`/`users`
  у эталона. Границы между ними резать заново не нужно.
- **`apps/core/` уже играет роль `core/` эталона**: контекст тенанта, RLS, поля, ошибки,
  менеджеры, роутеры БД, middleware.
- **Сервисный слой существует**, просто лежит плоско: `apps/catalog/services.py`,
  `apps/orders/services.py`, `apps/grms/commands.py` — это уже логика вне вьюх.
- **Единственная точка сборки роутеров есть** (`config/urls.py` + `api/__init__.py`) — как
  `app/api.py` у эталона.
- **Задачи и команды уже лежат по приложениям**: `apps/*/tasks.py` (15 задач),
  `apps/*/management/commands/` (13 команд).

---

## 3. Целевая раскладка и план

### Целевое дерево (по принципу эталона, не по его буквам)

```
backend/
├── config/                      без изменений (settings, urls, asgi, celery)
├── apps/
│   ├── core/                    как сейчас: контекст, RLS, поля, ошибки, менеджеры
│   ├── catalog/
│   │   ├── models/              category.py, item.py, modifier.py, facets.py, badge.py
│   │   ├── schemas/             guest.py, cms.py
│   │   ├── api/
│   │   │   ├── router.py
│   │   │   ├── guest/           catalog.py, item.py, search.py, home.py, slots.py
│   │   │   └── cms/             categories.py, items.py, modifiers.py, showcase.py, search.py
│   │   ├── services/            availability.py, showcase.py, search.py, home.py, inclusions.py
│   │   └── migrations/          НЕ ТРОГАЕМ
│   ├── hotels/
│   │   ├── models/              hotel.py, service.py, execution_point.py, room.py, module.py…
│   │   ├── schemas/             cms.py, platform.py, guest.py
│   │   ├── api/
│   │   │   ├── cms/             hotel.py, rooms.py, locations.py, services.py, brand.py,
│   │   │   │                    settings_home.py, settings_search.py, commerce.py
│   │   │   └── platform/        fleet.py, hotels.py, team.py, usage.py, tariffs.py
│   │   ├── services/            provisioning/, onboarding/, offboarding/, brand/, tariffs/
│   │   └── migrations/          НЕ ТРОГАЕМ
│   ├── grms/
│   │   ├── models/              api/{guest,cms}/  services/{commands,publishing,reconcile,…}
│   │   ├── transport/           adapter.py, emulator.py, transport.py
│   │   ├── consumers.py         ← имя и путь сохранить (строковая ссылка в routing)
│   │   └── tasks.py             ← имя модуля сохранить (имена задач Celery)
│   ├── orders/ chat/ reviews/ analytics/ notifications/ media/ accounts/ realtime/
│   │   └── по той же схеме
│   └── integrations/            weather/, payments/, pms/ — как сейчас
├── api/
│   └── __init__.py              ТОЛЬКО сборка: подключает роутеры приложений; ноль логики
└── tests/
    ├── conftest.py, helpers.py, fixtures/
    └── {app}/{api,services}/test_*.py
```

Отличия от эталона, продиктованные нашим продуктом:
- **два потребителя вместо одного** (гость и CMS/платформа) — режем `api/guest/` и `api/cms/`
  ВНУТРИ домена: это по-прежнему деление по ресурсу, просто ресурс виден двум аудиториям
  с разными правами и разными схемами;
- **RLS и мультитенантность** остаются в `apps/core` и в миграциях — переносу не подлежат;
- **WS-консьюмеры и on-prem узлы** — свои точки входа, у эталона их нет; трогать нельзя
  (см. риски).

### Таблица соответствия

| откуда | куда | примечание |
|---|---|---|
| `api/guest.py` (каталог, позиция, слоты) | `apps/catalog/api/guest/{catalog,item,slots}.py` | адреса те же |
| `api/guest.py` (сессия, отель) | `apps/accounts/api/guest/session.py` | |
| `api/guest.py` (корзина, заказы) | `apps/orders/api/guest/{cart,orders}.py` | |
| `api/chat_reviews.py` → главная | `apps/catalog/api/guest/home.py` | сейчас лежит не там вовсе |
| `api/chat_reviews.py` → поиск | `apps/catalog/api/guest/search.py` | |
| `api/chat_reviews.py` → чат, отзывы | `apps/chat/api/guest.py`, `apps/reviews/api/guest.py` | |
| `api/guest_room.py` | `apps/grms/api/guest.py` | |
| `api/cms/catalog.py` (55 эндпоинтов) | `apps/catalog/api/cms/*.py` + `apps/hotels/api/cms/settings_*.py` | режется по ресурсу |
| `api/cms/hotel_admin.py` | `apps/hotels/api/cms/{rooms,locations,services,schedules}.py` | |
| `api/cms/grms.py` | `apps/grms/api/cms/*.py` | |
| `api/cms/{brand,analytics,notifications,reviews,inclusions,common}.py` | `apps/{hotels,analytics,notifications,reviews,catalog}/api/cms/*.py` | |
| `api/platform.py` (38 эндпоинтов) | `apps/hotels/api/platform/*.py` | |
| `api/tracker.py`, `api/staff.py` | `apps/orders/api/staff/*.py`, `apps/accounts/api/staff.py` | |
| `api/onprem.py` | `apps/grms/api/onprem.py` | адрес и контракт узла не менять |
| `api/schemas.py`, `api/cms/schemas.py`, схемы из вьюх | `apps/{домен}/schemas/*.py` | |
| `apps/hotels/*.py` (25 плоских файлов) | `apps/hotels/{models,services,api}/…` | |
| `apps/catalog/*.py` | `apps/catalog/{models,services,api}/…` | |
| `apps/grms/*.py` | `apps/grms/{models,services,transport,api}/…` | `tasks.py`, `consumers.py` — на месте |
| `tests/test_*.py` (75 плоских) | `tests/{app}/{api,services}/test_*.py` | |

### Чего переносить НЕЛЬЗЯ или дорого

1. **Миграции — не трогаем вовсе.** 60+ файлов, часть с данными; `apps/catalog/migrations/0007_backfill_item_facets.py` и другие импортируют код приложения. Перенос модуля,
   на который ссылается миграция, ломает её задним числом. Модели переезжают в пакет
   `models/` **без смены `app_label` и `db_table`** — тогда миграции не замечают ничего.
2. **RLS-политики** (`apps/core/migrations/0002_rls.py` и далее) — это SQL по именам таблиц.
   Пока `db_table` не меняется, они целы; менять `db_table` нельзя ни при каких раскладах.
3. **Публичные адреса API.** `/api/v1/guest/*`, `/api/cms/*`, `/api/v1/platform/*`,
   `/api/onprem/*` — на них завязаны фронт, ~200 E2E, on-prem узлы и QR-ссылки. **Перенос
   файлов адреса не меняет.** Любое изменение адреса — отдельное решение пользователя, а не
   часть этого плана (см. СТОП).
4. **Имена Celery-задач.** Имя задачи — путь модуля: `apps.integrations.weather.tasks.refresh_hotel_weather`. Переезд модуля переименовывает задачу, и всё, что уже лежит
   в брокере, становится «unregistered task» — мы это уже видели на погоде. Модули `tasks.py`
   остаются на своих местах; если переезд неизбежен — только со старым именем через
   `@shared_task(name=...)`.
5. **WS-консьюмеры**: `apps/realtime/routing.py` ссылается на консьюмеры, `config/asgi.py` — на
   роутинг. Пути сохраняем.
6. **Команды `manage.py`** ищутся по пути `apps/*/management/commands/*.py` — 13 штук, включая
   `seed_demo_hotel`, `check_demo_stand`, `backfill_media_luminance`. Каталог не меняем.
7. **Пути в сидах**: сид читает файлы из `docs/design/grms-concept/` — это данные, не код,
   но пути в коде сида придётся оставить рабочими.

### Партии

Каждая партия — самостоятельный прогон: закончилась зелёным backend + E2E, значит её можно
слить. Партия, которую нельзя проверить прогоном, в список не попала.

| № | Партия | Объём | Риск | Чем проверяется |
|---|---|---|---|---|
| 0 | **Сеть безопасности** (см. §4): снимок карты URL, реестр задач, список команд, импорт всех модулей | S | нет | новые тесты падают на любой пропаже |
| 1 | Схемы по домам: `api/schemas.py`, `api/cms/schemas.py` и схемы из вьюх → `apps/*/schemas/` | M | низкий | полный прогон; адреса и тела ответов не меняются |
| 2 | `apps/catalog` по слоям: `models/`, `services/`, `api/` + переезд гостевых и CMS-вьюх каталога | L | средний | полный прогон + `check_demo_stand` |
| 3 | `apps/hotels` по слоям (самое крупное, 9869 строк): CMS-вьюхи, платформенные вьюхи, бренд, тарифы, провижининг | L | **высокий** | полный прогон + E2E платформы и CMS |
| 4 | `apps/grms` по слоям, `tasks.py`/`consumers.py` на месте | M | высокий (WS, on-prem) | полный прогон + `room-control.spec` + ручная проверка узла |
| 5 | `orders`, `chat`, `reviews`, `analytics`, `notifications`, `accounts`, `media` — по одному приложению | M×7 | низкий | полный прогон после каждого |
| 6 | `api/` схлопывается до сборки роутеров | S | низкий | полный прогон |
| 7 | Тесты зеркалят структуру: `tests/{app}/{api,services}/` | M | низкий | сам прогон и есть проверка |

Порядок не случаен: сначала сеть безопасности, потом самое изолированное (схемы), потом каталог
как образец переноса, и только после него — hotels и grms, где цена ошибки выше всего.

---

## 4. Риски

### Что может тихо сломаться

1. **Импорты в миграциях.** Часть миграций импортирует код приложения. Переезд модуля ломает
   миграцию на чистой базе — а это ровно тот путь, которым поднимается CI и новый разработчик.
   Наш прогон миграции гоняет (тестовая база создаётся с нуля), так что это ЗАМЕТНО.
2. **Строковые ссылки на модели.** `"hotels.Service"`, `"media.MediaAsset"` в FK — они завязаны
   на `app_label`, а не на путь файла. Пока модели остаются в том же приложении, ссылки целы.
   Переезд модели МЕЖДУ приложениями — отдельная история с миграцией и в план не входит.
3. **Имена Celery-задач** — молчаливая поломка: код импортируется, тесты (eager) проходят,
   а воркер в проде отвечает «Received unregistered task». Один раз уже поймано.
4. **WS-консьюмеры**: роутинг по строке пути; ошибка вылезет только при живом подключении.
5. **`manage.py`-команды**: Django ищет их по каталогу; пропажу увидит только тот, кто позовёт
   команду — то есть сид, уборка стенда или ops.
6. **Пути в сидах и тестах**: `grms_harness.py`, фикстуры, `docs/design/grms-concept/*.json`.
7. **`INSTALLED_APPS`**: переезд пакета без правки списка ломает автодискавери задач и команд.

### Дыры в текущей сети (787 backend + ~220 E2E)

Чего НЕТ, и что стоит добавить ДО первой партии — это и есть партия 0:

1. **Снимка карты URL.** Ни один тест не проверяет, что набор адресов не изменился. Перенос
   вьюхи с потерей регистрации роутера даст 404 — и его поймает только тот E2E, который этот
   адрес зовёт. Нужен тест: собрать пути из OpenAPI-схемы и сверить со снимком в файле.
2. **Реестра задач Celery.** Никто не проверяет, что задача зарегистрирована под ожидаемым
   именем. Нужен тест: список имён из `app.tasks` против ожидаемого набора.
3. **Списка команд `manage.py`.** Нужен тест: `get_commands()` содержит наши 13.
4. **Импорта всех модулей.** Ошибка импорта в модуле, который не зовёт ни один тест, живёт до
   первого обращения. Нужен smoke-тест: пройти `pkgutil.walk_packages` по `apps` и `api`.
5. **Проверки, что вьюхи не ходят в ORM.** Сейчас правило существует только в голове.
   Дешёвый линт (как `lint:colors` на фронте) закрепил бы результат переноса.

Без пунктов 1–4 перенос «зелёный» будет означать «то, что тесты зовут, работает», а не «ничего
не пропало». С ними — партии становятся проверяемыми, как и требуется.

### Отдельно, как решение пользователя (СТОП-пункты)

- **Менять публичные адреса API** — в план не входит и в партиях не заложено. Если решим
  привести адреса к единому виду (`/api/v1/...` везде), это отдельная работа с версионированием,
  правкой фронта, E2E и on-prem узлов.
- **Трогать миграции** (схлопывать, переписывать) — не входит. Живой стенд и демо-данные
  пережили 60+ миграций; их переписывание — отдельный риск без выгоды для раскладки.
