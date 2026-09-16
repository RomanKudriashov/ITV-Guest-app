# Контракт админки отеля: номера/QR, локации, отделы, персонал

Фиксируется **до** реализации. Префикс: `/api/v1/cms`. Аутентификация и тенант —
как у остальной CMS. Всё в скоупе отеля.

## 1. Номера

Объект:
```jsonc
{
  "id": "...", "number": "305", "floor": "3", "zone": "Главный корпус",
  "source": "manual", "is_active": true,
  "guest_url": "https://crystal.guest.localhost/r/305",  // что кодирует QR
  "category_id": "...", "category": {"id": "...", "code": "deluxe", "title": "Делюкс"},
  "housekeeping": "unknown",   // unknown | clean | dirty | in_progress
  "out_of_service": false,     // «вне продажи» — ОТДЕЛЬНО от is_active
  "restored": false,           // только в ответе POST: номер ВЕРНУЛСЯ из удалённых
  "restored_orders": 0, "restored_sessions": 0, "revoked_sessions": 0
}
```

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/cms/rooms` | список |
| POST | `/api/v1/cms/rooms` | один номер |
| PATCH / DELETE | `/api/v1/cms/rooms/{id}` | |
| POST | `/api/v1/cms/rooms/bulk` | добавить диапазоном |
| GET | `/api/v1/cms/rooms/{id}/qr.svg` · `.png` | QR одного номера |
| GET | `/api/v1/cms/rooms/qr-sheet` | печатный лист всех QR (HTML) |
| GET | `/api/v1/cms/rooms/{id}/rename-check?number=` | что изменится при переименовании |
| GET | `/api/v1/cms/rooms/grid` | сетка фонда: корпуса → этажи → кубики |
| POST | `/api/v1/cms/rooms/bulk/preview` | предпросмотр заведения пачкой (НИЧЕГО не создаёт) |
| POST | `/api/v1/cms/rooms/bulk-update` | правка пачкой по выборке |
| GET · POST | `/api/v1/cms/room-categories` | справочник категорий |
| PATCH · DELETE | `/api/v1/cms/room-categories/{id}` | |

**bulk** — заведение пачкой. Два вида ввода:
```jsonc
{"spec": "101-105, 3А, Люкс-1", "floor": "1", "prefix": "", "suffix": ""}
{"from": 101, "to": 120, "floor": "1"}        // прежняя форма, осталась рабочей
```
`spec` — диапазоны и отдельные номера через запятую. Диапазон только между
целыми, ширина берётся по левой границе («008-012» → 008…012); всё прочее —
номер как написан, с буквами. Повторы внутри строки схлопываются.

Уже существующие пропускаются молча (идемпотентно); ответ —
`{"created": [...], "skipped": [...], "restored": [...], "created_count": N,
"skipped_count": M}`. Больше 500 номеров — `422 range_too_large`, и НИ ОДИН не
создаётся: предел проверяется на всём списке до записи. `from > to` или
перевёрнутый диапазон внутри `spec` — `422 bad_range`.

**bulk/preview** — тот же ввод, но только чтение:
```jsonc
{"numbers": [...], "will_create": [...], "exists": [...], "will_restore": [...],
 "total": 7, "create_count": 6, "exists_count": 1}
```
Отдельная ручка, а не флаг у создания: флаг однажды забудут передать, и
опечатка «1-99999» создаст фонд на девяносто тысяч комнат. `will_restore` —
номера, которые ВЕРНУТСЯ с историей, а не заведутся заново.

**bulk-update** — правка пачкой:
```jsonc
{"selection": {"all_matching": true, "search": "", "filters": {"floor": "3"}},
 "patch": {"category_id": "...", "housekeeping": "dirty", "out_of_service": true}}
{"selection": {"ids": ["...", "..."]}, "patch": {"zone": "Корпус Б"}}
```
Ответ — `{"matched": N, "changed": M}` по факту, а не по намерению.

ВЫБОРКА — ИЗ ФИЛЬТРОВ, А НЕ ИЗ ВИДИМОГО. `all_matching` означает «все по
текущей выборке», и множество строит СЕРВЕР по тем же `search`/`filters`, что
и список: клиент видел страницу (50 строк), а не все 314. Варианта «все на
странице» нет намеренно — это и есть ложь.

`number` в `patch` — `422 rename_not_bulk`: у каждого номера своя наклейка QR
и своё имя устройства, подтверждать это надо поштучно. Пустая выборка —
`422 empty_selection`, пустая правка — `422 empty_patch`: молчаливый ноль
читается как «сделано».

**Фильтры списка** (`GET /rooms`): `floor`, `zone`, `category` (идентификатор
или `none` — номера без категории), `housekeeping`, `out_of_service`. Те же
значения принимает `selection.filters` — два разных множества под одним словом
«выборка» были бы готовой ошибкой.

**Категории** — тарифные, из справочника отеля; к `grms.RoomType` отношения не
имеют (тот про оборудование, включается тарифом и связан с комнатой OneToOne).
Объект: `{id, code, title, title_i18n, sort_order, is_active, rooms_count}`.
Удаление занятой категории — `409 category_in_use` с `rooms_count`: номера
остались бы со ссылкой на несуществующую строку.

**grid** — весь фонд разом, без листания и без фильтров:
```jsonc
{
  "buildings": [{"zone": "Главный корпус", "floors": [
     {"floor": "3", "key": "00000003", "rooms": [
        {"...": "поля номера", "active_orders": 2, "overdue_orders": 1, "device": "online"}]}]}],
  "total": 314, "truncated": false, "occupancy": "unknown"
}
```
Фильтры сюда не передаются НАМЕРЕННО: на сетке отфильтрованное гасится, а не
исчезает — убрав кубики, мы порвём ряды, и соседние номера перестанут стоять
рядом. Гасит клиент.

`device`: `online` · `offline` · `no_node` · `null` (номер не управляется — это
штатный ответ, а не поломка). Живость берётся у он-прем узла, одна на отель:
опрашивать каждую комнату по живому сокету значило бы открывать экран минуту.

`occupancy: "unknown"` — занятости у нас нет и не будет до PMS. Сервер говорит
это прямо, чтобы экран не выдумывал её сам и не красил кубики наугад.

**Состояние уборки** ставит персонал: `unknown | clean | dirty | in_progress`.
`unknown` по умолчанию и это честно — у только что заведённого номера
состояния нет. ЗАНЯТОСТИ В ФОНДЕ НЕТ ВОВСЕ: без PMS её неоткуда взять, а
ручной статус, который никто не обновляет, — это экран, который врёт.

**QR кодирует рабочий deep-link** `/r/{number}` на публичном адресе отеля
(`Hotel.public_guest_url`) — ровно тот, что понимает гостевой вход. `.svg`
отдаётся `image/svg+xml`, `.png` — `image/png`. Скан ведёт гостя на витрину,
привязанную к номеру.

`qr-sheet` — самодостаточная HTML-страница (инлайн-SVG, стили печати), готовая
к печати из браузера: сетка карточек «номер + QR».

**Порядок — человеческий, а не лексикографический.** Список сортируется по
служебному ключу `Room.sort_key` (каждая группа цифр дополнена нулями до восьми
разрядов): `3А, 12, 99, 100, 101, 101а, 1201, Люкс-1`. Сортировка по строке
ставила `12` после `101`.

**Листание страницами**: `?limit=&offset=`, ответ — оболочка
`{items, total, limit, offset, truncated}`. Предел по умолчанию 100, максимум
500. `total` — весь фонд под текущим поиском, а не длина страницы.

**Переименование — только с подтверждением.** `PATCH` со сменой `number` без
`confirm_rename: true` отвечает `409 rename_needs_confirmation` и несёт в
`impact` то же, что и `rename-check`:

```jsonc
{
  "number": "305", "new_number": "3005", "taken": false,
  "qr_url": ".../r/305",        // наклейка в номере ведёт сюда — и умрёт
  "qr_url_after": ".../r/3005",
  "device": "Modbus TCP Server (Slave mode) 305",        // имя устройства iRidi
  "device_after": "Modbus TCP Server (Slave mode) 3005", // соберётся из нового номера
  "device_changes": true,
  "live_sessions": 2, "has_pin": true
}
```

Причина, по которой смена номера не проходит молча: QR кодирует НОМЕР, а имя
устройства iRidi собирается из номера шаблоном типа. Оба последствия не видны
из интерфейса, а ломают продукт целиком — наклейка ведёт в никуда, команды
уходят на несуществующее устройство.

`keep_device_name: true` при подтверждённом переименовании закрепляет за
связью комнаты ТЕКУЩЕЕ имя устройства (`RoomTypeRoom.device_name_override`):
номер меняется, оборудование не трогается.

**Номер удалённой комнаты свободен.** Удаление мягкое, но уникальность теперь
проверяется только среди живых. `POST` с номером, который занимает удалённая
комната, ВОЗВРАЩАЕТ её (`"restored": true`, тот же `id`) вместе с историей
заказов и сессий — и гасит доступ прежнего проживания: живые гостевые сессии
отзываются, PIN снимается.

---

## 2. Локации

Объект:
```jsonc
{
  "id": "...", "code": "pool", "kind": "common_point",
  "title": {"ru": "У бассейна"}, "requires_refinement": true,
  "refinement_label": {"ru": "Номер шезлонга"},
  "schedule_id": "..." | null, "sort_order": 1, "is_active": true
}
```

| Метод | Путь |
|---|---|
| GET / POST | `/api/v1/cms/locations` |
| PATCH / DELETE | `/api/v1/cms/locations/{id}` |

`kind`: `in_room` | `common_point`. `requires_refinement=true` требует
непустого `refinement_label` — иначе `422 refinement_label_required`.
Расписание — как у категорий/блюд (`schedule_id`).

### Матрица «категория → локации»

Где категория доставляется и как. Строится по существующей `ServiceLocation`.

```
GET /api/v1/cms/locations/matrix
{
  "locations": [{"id","code","title"}, ...],
  "rows": [
    {"category_id": "...", "category_title": "Горячее",
     "cells": [{"location_id": "...", "enabled": true,
                "delivery_modes": ["delivery","pickup"]}]}
  ]
}

PUT /api/v1/cms/locations/matrix
{"category_id": "...", "cells": [{"location_id","enabled","delivery_modes"}]}
```
`enabled=false` убирает связку; матрица заменяет строку категории целиком.

---

## 3. Отделы (точки исполнения)

Живут под `/api/v1/cms/services` — адреса `/cms/departments` не существует и
никогда больше не появится: понятие «отдел» переименовано в заведение (сервис),
и переименование дошло до маршрутов. Состав полей смотреть в машинной схеме
(`/api/openapi.json`), здесь — только смысл.

`kind` — из `ExecutionPoint.Kind` (kitchen/bar/housekeeping/spa/reception/other).

**Удалить заведение с заказами нельзя** — `409 service_has_orders`, его можно
только выключить. Причина не в осторожности: заказы ссылаются на точку через
`PROTECT`, и удаление осиротило бы историю выручки.

Счётчики персонала, каналов и признак эскалации отдаются в списке затем, чтобы
связь заведения с уведомлениями была видна ДО того, как его выключат.

**Модель (R1).** «Отдел» = исполнитель (`ExecutionPoint`) **+ его сервис**
(`Service`, 1:1). Форма объекта не изменилась, но источники разделены:
`title`/`kind`/`sla_minutes` — на исполнителе; **`public_name`/`tagline`/
`is_guest_facing`/`image`/`schedule_id` (венью-часы) — на сервисе**. POST создаёт
оба, DELETE снимает оба, PATCH пишет каждое поле в свою модель. Смена `kind`
тянет за собой тип-шаблон сервиса (группировка витрины следует за родом).

**Фото точки.** У отдела есть `image_id` (id ассета из медиапайплайна) на вход
PATCH/POST и `image` (сериализованный ассет с `url`/`status`) на выходе — теперь
хранится на сервисе. Фото грузится через `POST /api/v1/cms/media` (kind
`category`), затем id передаётся в `image_id`. Витрина использует его как обложку
плитки и hero каталога (см. guest-контракт).

---

## 4. Персонал

`GET /api/v1/cms/staff` даёт список сотрудников для
выбора в персональном канале уведомлений.

Объект:
```jsonc
{
  "id": "...", "email": "chef@crystal.local", "full_name": "Пётр, повар",
  "language": "ru", "is_hotel_admin": false, "is_active": true,
  "assignments": [
    {"id": "...", "execution_point_id": "...", "execution_point_code": "kitchen",
     "level": "lead", "is_active": true}
  ]
}
```

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/cms/staff` | список сотрудников отеля (+ привязки) |
| POST | `/api/v1/cms/staff` | создать (с паролем) |
| PATCH / DELETE | `/api/v1/cms/staff/{id}` | |
| PUT | `/api/v1/cms/staff/{id}/assignments` | заменить набор привязок |

Создание:
```jsonc
{"email": "waiter@crystal.local", "full_name": "Олег", "password": "secret123",
 "language": "ru", "is_hotel_admin": false,
 "assignments": [{"execution_point_id": "...", "level": "member"}]}
```

Правила:
* email уникален глобально (это ключ входа) — `409 email_taken`;
* пароль при создании обязателен, минимум 8 символов — `422 weak_password`;
* PATCH без `password` его не меняет; с `password` — меняет;
* `level` — `member` | `lead` | `manager`;
* нельзя удалить или деактивировать **самого себя** — `409 cannot_remove_self`
  (иначе админ запрёт себя снаружи);
* привязка к чужому отделу (другого отеля) невозможна — RLS не отдаст точку.

`PUT .../assignments` заменяет привязки целиком: `[{execution_point_id, level}]`.

---

## 5. Публичный адрес отеля

`Hotel.public_guest_url(path)` — база для QR и ссылок:
`{scheme}://{custom_domain или subdomain.base_domain}{path}`. Схема —
`GUEST_APP_PUBLIC_SCHEME` (в проде `https`, в деве `http`). Для QR
`path="/r/{number}"`.
