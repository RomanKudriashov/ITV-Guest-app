# Контракт CMS API (прогон 2: «Меню» + редактор блюда)

Документ фиксирует контракт между бэкендом и CMS-фронтом. Пишется до
реализации, чтобы обе стороны собирались параллельно.

Базовый префикс: `/api/v1/cms`. Аутентификация: `Authorization: Bearer <JWT>`.

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

### `POST /api/v1/staff/auth/login`
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

### `GET /api/v1/staff/auth/me` → тот же объект `user` + `hotel`

---

## 2. Bootstrap CMS

### `GET /api/v1/cms/bootstrap`
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
| GET | `/api/v1/cms/categories` | дерево (корни с `children`) |
| POST | `/api/v1/cms/categories` | создать |
| GET | `/api/v1/cms/categories/{id}` | одна категория (плоско) |
| PATCH | `/api/v1/cms/categories/{id}` | частичное обновление |
| DELETE | `/api/v1/cms/categories/{id}?cascade=false` | удалить |
| POST | `/api/v1/cms/categories/reorder` | сортировка/перенос |
| POST | `/api/v1/cms/categories/{id}/toggle` | вкл/выкл |

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
  "type": "product",                 // product | service_request
  "location_mode": "delivery",       // delivery | room | none
  "title":{...}, "description":{...},
  "price": 190000,                   // null — «цена не указана»
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
| GET | `/api/v1/cms/items?category_id=&search=&type=` | список (без `modifier_groups`) |
| POST | `/api/v1/cms/items` | создать |
| GET | `/api/v1/cms/items/{id}` | полный объект **с** модификаторами |
| PATCH | `/api/v1/cms/items/{id}` | частичное обновление |
| DELETE | `/api/v1/cms/items/{id}` | удалить |
| POST | `/api/v1/cms/items/reorder` | `{"category_id","items":[{"id","sort_order"}]}` |
| POST | `/api/v1/cms/items/{id}/stock` | `{"in_stock": false}` — стоп-лист |
| POST | `/api/v1/cms/items/{id}/toggle` | `{"is_active": false}` |
| PUT | `/api/v1/cms/items/{id}/images` | `{"image_ids": ["...", "..."]}` — порядок |

Валидация: `price >= 0` либо `null`; `title` должен иметь непустое значение
хотя бы на языке отеля по умолчанию (`422 field=title`); `flags`/`allergens` —
только коды из `bootstrap`.

`type` задаётся при создании и **не меняется** потом: у товара есть
модификаторы и корзина, у заявки — поля и форма, и переключение типа на лету
осиротило бы одно из двух. Смена типа — `422 type_immutable`.
`location_mode` по умолчанию берётся из реестра поведений
([`offering-types.md`](offering-types.md)), но отель может его переопределить.

---

## 5a. Поля заявки-услуги

Есть только у позиций типа `service_request` — так же, как модификаторы есть
только у товаров. Устроено по образцу групп модификаторов.

```jsonc
{
  "id": "...", "item_id": "...", "code": "destination",
  "label": {"ru": "Куда", "en": "Where to"},
  "help_text": {"ru": "Адрес или название места"},
  "field_type": "text",              // text|number|count|date|time|select
  "is_required": true,
  "options": [{"value": "econom", "label": {"ru": "Эконом"}}],
  "min_value": null, "max_value": null,
  "sort_order": 0
}
```

| Метод | Путь |
|---|---|
| POST | `/api/v1/cms/items/{item_id}/request-fields` |
| PATCH / DELETE | `/api/v1/cms/request-fields/{id}` |
| POST | `/api/v1/cms/items/{item_id}/request-fields/reorder` |

Правила (проверяет сервер):
* `select` без вариантов — `422 select_without_options`;
* `min_value > max_value` — `422 invalid_range`;
* границы задаются только для `number` и `count`;
* поля у позиции типа `product` — `422 fields_not_supported`.

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
| POST | `/api/v1/cms/items/{item_id}/modifier-groups` |
| PATCH / DELETE | `/api/v1/cms/modifier-groups/{id}` |
| POST | `/api/v1/cms/items/{item_id}/modifier-groups/reorder` |
| POST | `/api/v1/cms/modifier-groups/{group_id}/options` |
| PATCH / DELETE | `/api/v1/cms/modifier-options/{id}` |
| POST | `/api/v1/cms/modifier-groups/{group_id}/options/reorder` |

Правила (проверяет сервер, а не только форма):
* `selection=single` → `max_choices` принудительно 1;
* `is_required=true` → `min_choices >= 1`;
* `min_choices <= max_choices`;
* `min_choices` не больше числа активных опций — иначе `422 code=not_enough_options`;
* обязательная группа без опций — `422 code=required_group_empty`.

---

## 6. Медиа

### `POST /api/v1/cms/media` — `multipart/form-data`
Поля: `file` (обязательно), `kind` (`item`|`category`|`brand`, по умолчанию `item`).

Ответ `201`:
```jsonc
{"id":"...","status":"pending","url":"","thumb_url":"",
 "original_filename":"steak.jpg"}
```
Оригинал уже в MinIO; варианты режет Celery. Пока `status != "ready"` поля
`url`/`thumb_url` пустые — UI показывает превью из локального `URL.createObjectURL`
и опрашивает статус.

### `GET /api/v1/cms/media/{id}` → тот же объект с актуальным `status` и URL'ами.

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
| GET | `/api/v1/cms/schedules` |
| POST | `/api/v1/cms/schedules` (вместе с `intervals`) |
| PATCH | `/api/v1/cms/schedules/{id}` (`intervals` заменяют набор целиком) |
| DELETE | `/api/v1/cms/schedules/{id}` |

Валидация: `start_time != end_time`; интервал через полночь разрешён
(23:00–02:00) и трактуется как переход на следующие сутки.

---

## Маркетинговые бейджи (A3+ шаг 3)

Бейджи — **отдельная маркетинговая сущность**, не флаги позиции (флаги
фактические: аллергены, веган, острое; бейджи — «Хит», «Новинка», «Выбор
шефа»). Вешаются на позицию **любого из 4 типов** — ветвления по типу нет.

**Цвет — роль из токенов темы**, не произвольный hex: `accent` / `gold` /
`success` / `info`. Отель задаёт роль; витрина красит токеном и берёт читаемый
цвет текста по контрасту — поэтому бейдж не проваливает контраст при смене
темы. Роли проходят сторож контраста.

### CRUD (`auth=StaffAuth` на роутере `/api/v1/cms`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/badges` | список бейджей отеля |
| POST | `/badges` | создать: `{label:{lang}, color_role, sort_order?, is_active?}` |
| PATCH | `/badges/{id}` | правка |
| DELETE | `/badges/{id}` | мягко удалить |
| PUT | `/items/{id}/badges` | назначить позиции набор: `{badge_ids:[...]}` (заменяет) |

`color_role ∈ {accent, gold, success, info}`. Пресеты (Хит/Новинка/Выбор шефа)
сидируются за флагом `--with-marketing-badges` (не сдвигают ID тестов).

Позиция в CMS (`serialize_item`) несёт `badges: [{id, label, color_role,
sort_order}]`.

---

## Быстрые действия стартовой (A3+ шаг 4)

Упорядоченный выбор действий для гостевой стартовой из **фиксированного
словаря** (выведен из реальных разделов витрины): `menu`, `services`, `slots`,
`info`, `chat`. Хранится в `hotel.settings["quick_actions"]` — новой таблицы не
требуется.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/cms/quick-actions` | `{available:[словарь], selected:[коды]}` |
| PUT | `/api/v1/cms/quick-actions` | `{selected:[коды]}` — заменяет набор; коды вне словаря → 422 |

Пусто/не задано → витрина показывает разумный дефолт (наполненные разделы + чат).
