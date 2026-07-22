# Контракт админки отеля (прогон 8): номера/QR, локации, отделы, персонал

Фиксируется **до** реализации. Префикс: `/api/cms`. Аутентификация и тенант —
как у остальной CMS. Всё в скоупе отеля.

## 1. Номера

Объект:
```jsonc
{
  "id": "...", "number": "305", "floor": "3", "zone": "Главный корпус",
  "source": "manual", "is_active": true,
  "guest_url": "https://crystal.guest.localhost/r/305"   // что кодирует QR
}
```

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/cms/rooms` | список |
| POST | `/api/cms/rooms` | один номер |
| PATCH / DELETE | `/api/cms/rooms/{id}` | |
| POST | `/api/cms/rooms/bulk` | добавить диапазоном |
| GET | `/api/cms/rooms/{id}/qr.svg` · `.png` | QR одного номера |
| GET | `/api/cms/rooms/qr-sheet` | печатный лист всех QR (HTML) |

**bulk** — генерация диапазона:
```jsonc
{"from": 101, "to": 120, "floor": "1", "zone": "", "prefix": "", "suffix": ""}
// → номера 101..120 (с prefix/suffix, если заданы: "A101").
```
Уже существующие номера пропускаются молча (идемпотентно); ответ —
`{"created": ["101", ...], "skipped": ["105"]}`. Диапазон больше 500 —
`422 range_too_large`. `from > to` — `422 bad_range`.

**QR кодирует рабочий deep-link** `/r/{number}` на публичном адресе отеля
(`Hotel.public_guest_url`) — ровно тот, что понимает гостевой вход. `.svg`
отдаётся `image/svg+xml`, `.png` — `image/png`. Скан ведёт гостя на витрину,
привязанную к номеру.

`qr-sheet` — самодостаточная HTML-страница (инлайн-SVG, стили печати), готовая
к печати из браузера: сетка карточек «номер + QR».

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
| GET / POST | `/api/cms/locations` |
| PATCH / DELETE | `/api/cms/locations/{id}` |

`kind`: `in_room` | `common_point`. `requires_refinement=true` требует
непустого `refinement_label` — иначе `422 refinement_label_required`.
Расписание — как у категорий/блюд (`schedule_id`).

### Матрица «категория → локации»

Где категория доставляется и как. Строится по существующей `ServiceLocation`.

```
GET /api/cms/locations/matrix
{
  "locations": [{"id","code","title"}, ...],
  "rows": [
    {"category_id": "...", "category_title": "Горячее",
     "cells": [{"location_id": "...", "enabled": true,
                "delivery_modes": ["delivery","pickup"]}]}
  ]
}

PUT /api/cms/locations/matrix
{"category_id": "...", "cells": [{"location_id","enabled","delivery_modes"}]}
```
`enabled=false` убирает связку; матрица заменяет строку категории целиком.

---

## 3. Отделы (точки исполнения)

Объект:
```jsonc
{
  "id": "...", "code": "kitchen", "title": {"ru": "Кухня ресторана"},
  "kind": "kitchen", "schedule_id": "..." | null, "sla_minutes": 20,
  "is_active": true,
  "staff_count": 1, "channel_count": 1, "has_escalation": true   // связь с прогоном 6
}
```

| Метод | Путь |
|---|---|
| GET / POST | `/api/cms/departments` |
| PATCH / DELETE | `/api/cms/departments/{id}` |

`kind` — из `ExecutionPoint.Kind` (kitchen/bar/housekeeping/spa/reception/other).
Удаление отдела с заказами/каналами — `409 department_in_use`. Счётчики
`staff_count`/`channel_count`/`has_escalation` — чтобы из списка отделов было
видно связь с каналами и эскалацией (прогон 6).

---

## 4. Персонал

Закрывает пробел прогона 6: `GET /api/cms/staff` даёт список сотрудников для
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
| GET | `/api/cms/staff` | список сотрудников отеля (+ привязки) |
| POST | `/api/cms/staff` | создать (с паролем) |
| PATCH / DELETE | `/api/cms/staff/{id}` | |
| PUT | `/api/cms/staff/{id}/assignments` | заменить набор привязок |

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
