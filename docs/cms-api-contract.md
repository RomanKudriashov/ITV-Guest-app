# Контракт CMS API (прогон 2: «Меню» + редактор блюда)

Документ фиксирует контракт между бэкендом и CMS-фронтом. Пишется до
реализации, чтобы обе стороны собирались параллельно.

Базовый префикс: `/api/cms`. Аутентификация: `Authorization: Bearer <JWT>`.

## Тенант

Отель определяется поддоменом (`crystal.guest.localhost`). В деве, где фронт
живёт на `localhost:5183` и ходит через vite-прокси, поддомена нет — поэтому
клиент **всегда** шлёт заголовок:

```
X-Hotel-Subdomain: crystal
```

Он принимается только при `DJANGO_DEBUG=1`. В проде тенант берётся из Host.

## Общие правила

* Все суммы — целые, **в минимальных единицах валюты (копейках)**. UI делит на
  `10 ** currency_minor_units` при показе и умножает при отправке.
  `1 900 ₽` → `190000`.
* `currency_minor_units` из `bootstrap` — это **число знаков после запятой**
  (показатель степени), а не множитель: для рубля приходит `2`, а не `100`.
* Переводимые поля — объекты `{"ru": "...", "en": "..."}`. Пустые языки просто
  отсутствуют. Читать для показа — по языку интерфейса с фолбэком.
* `id` — UUID-строки.
* Ошибки валидации: `422` с телом `{"detail": "...", "code": "validation_error",
  "field": "price"}` (поле опционально). Прочие ошибки — `{"detail","code"}`.
* Мягкое удаление: `DELETE` помечает `deleted_at`, из списков пропадает.

---

## 1. Аутентификация персонала

### `POST /api/staff/auth/login`
```jsonc
// запрос
{"email": "chef@crystal.local", "password": "chef12345"}
// ответ 200
{
  "access": "<jwt>",
  "refresh": "<jwt>",
  "user": {"id": "...", "email": "...", "full_name": "...",
           "is_hotel_admin": false, "language": "ru"}
}
// 401 {"detail": "Неверный логин или пароль", "code": "auth_failed"}
```

### `GET /api/staff/auth/me` → тот же объект `user` + `hotel`

---

## 2. Bootstrap CMS

### `GET /api/cms/bootstrap`
Всё, что редактору нужно знать до первого рендера.

```jsonc
{
  "hotel": {"id","name","subdomain","currency","currency_minor_units",
            "timezone","default_language"},
  "languages": [{"code":"ru","title":"Русский","is_default":true}, ...],
  "flags":     [{"code":"vegan","title":{"ru":"Веган","en":"Vegan"}}, ...],
  "allergens": [{"code":"gluten","title":{"ru":"Глютен","en":"Gluten"}}, ...],
  "schedules": [{"id","name","is_always_open","intervals":[...]}],
  "execution_points": [{"id","code","title":{...}}],
  "day_parts": ["breakfast","lunch","dinner","late_night"]
}
```

---

## 3. Категории

Объект категории:
```jsonc
{
  "id": "...", "parent_id": null, "code": "hot",
  "title": {"ru":"Горячее","en":"Hot dishes"},
  "description": {...},
  "image": {"id":"...","url":"http://...","status":"ready"} | null,
  "schedule_id": "..." | null,
  "sort_order": 0, "is_active": true,
  "items_count": 3,
  "children": [ ...то же... ]
}
```

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/cms/categories` | дерево (корни с `children`) |
| POST | `/api/cms/categories` | создать |
| GET | `/api/cms/categories/{id}` | одна категория (плоско) |
| PATCH | `/api/cms/categories/{id}` | частичное обновление |
| DELETE | `/api/cms/categories/{id}?cascade=false` | удалить |
| POST | `/api/cms/categories/reorder` | сортировка/перенос |
| POST | `/api/cms/categories/{id}/toggle` | вкл/выкл |

Тело POST/PATCH: `{title, description, code?, parent_id, image_id, schedule_id,
sort_order, is_active}`. `code` генерируется из title, если не передан.

**DELETE**: если в категории есть блюда или подкатегории и `cascade=false` —
`409 {"code":"category_not_empty","items_count":N,"children_count":M}`.
С `cascade=true` мягко удаляются и вложенные.

**reorder**: `{"items": [{"id": "...", "parent_id": null, "sort_order": 0}, ...]}`
— полный новый порядок затронутых узлов, применяется одной транзакцией.
Ответ — обновлённое дерево. Запрет цикла (нельзя перенести в своего потомка):
`422 {"code":"cycle_detected"}`.

**toggle**: `{"is_active": true}`.

---

## 4. Блюда (Item, type=product)

Объект:
```jsonc
{
  "id","category_id","code",
  "title":{...}, "description":{...},
  "price": 190000,
  "images": [{"id","url","thumb_url","status","sort_order"}],
  "flags": ["chef_choice","gluten_free"],
  "allergens": ["milk"],
  "schedule_id": null,
  "sort_order": 0, "is_active": true, "in_stock": true,
  "modifier_groups": [ ...см. §5... ]
}
```

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/cms/items?category_id=&search=` | список (без `modifier_groups`) |
| POST | `/api/cms/items` | создать |
| GET | `/api/cms/items/{id}` | полный объект **с** модификаторами |
| PATCH | `/api/cms/items/{id}` | частичное обновление |
| DELETE | `/api/cms/items/{id}` | удалить |
| POST | `/api/cms/items/reorder` | `{"category_id","items":[{"id","sort_order"}]}` |
| POST | `/api/cms/items/{id}/stock` | `{"in_stock": false}` — стоп-лист |
| POST | `/api/cms/items/{id}/toggle` | `{"is_active": false}` |
| PUT | `/api/cms/items/{id}/images` | `{"image_ids": ["...", "..."]}` — порядок |

Валидация: `price >= 0`; `title` должен иметь непустое значение хотя бы на
языке отеля по умолчанию (`422 field=title`); `flags`/`allergens` — только коды
из `bootstrap`.

---

## 5. Группы модификаторов и опции

```jsonc
{
  "id","item_id","code",
  "title":{...},
  "selection":"single"|"multi",
  "is_required": true,
  "min_choices": 1, "max_choices": 1,
  "sort_order": 0,
  "options":[{"id","code","title":{...},"price_delta":15000,
              "is_default":false,"is_active":true,"sort_order":0}]
}
```

| Метод | Путь |
|---|---|
| POST | `/api/cms/items/{item_id}/modifier-groups` |
| PATCH / DELETE | `/api/cms/modifier-groups/{id}` |
| POST | `/api/cms/items/{item_id}/modifier-groups/reorder` |
| POST | `/api/cms/modifier-groups/{group_id}/options` |
| PATCH / DELETE | `/api/cms/modifier-options/{id}` |
| POST | `/api/cms/modifier-groups/{group_id}/options/reorder` |

Правила (проверяет сервер, а не только форма):
* `selection=single` → `max_choices` принудительно 1;
* `is_required=true` → `min_choices >= 1`;
* `min_choices <= max_choices`;
* `min_choices` не больше числа активных опций — иначе `422 code=not_enough_options`;
* обязательная группа без опций — `422 code=required_group_empty`.

---

## 6. Медиа

### `POST /api/cms/media` — `multipart/form-data`
Поля: `file` (обязательно), `kind` (`item`|`category`|`brand`, по умолчанию `item`).

Ответ `201`:
```jsonc
{"id":"...","status":"pending","url":"","thumb_url":"",
 "original_filename":"steak.jpg"}
```
Оригинал уже в MinIO; варианты режет Celery. Пока `status != "ready"` поля
`url`/`thumb_url` пустые — UI показывает превью из локального `URL.createObjectURL`
и опрашивает статус.

### `GET /api/cms/media/{id}` → тот же объект с актуальным `status` и URL'ами.

Ограничения: не больше 10 МБ, только `image/jpeg|png|webp` — иначе
`422 code=unsupported_media`.

---

## 7. Расписания

```jsonc
{"id","name","is_always_open",
 "intervals":[{"id","weekday":0,"start_time":"07:00","end_time":"23:00",
               "day_part":"breakfast"}]}
```
`weekday`: 0 — понедельник … 6 — воскресенье. Времена — локальные для отеля,
формат `HH:MM`.

| Метод | Путь |
|---|---|
| GET | `/api/cms/schedules` |
| POST | `/api/cms/schedules` (вместе с `intervals`) |
| PATCH | `/api/cms/schedules/{id}` (`intervals` заменяют набор целиком) |
| DELETE | `/api/cms/schedules/{id}` |

Валидация: `start_time != end_time`; интервал через полночь разрешён
(23:00–02:00) и трактуется как переход на следующие сутки.
