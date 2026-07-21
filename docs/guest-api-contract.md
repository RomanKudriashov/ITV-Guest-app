# Контракт гостевого API (прогон 3: витрина + заказ + живой статус)

Документ фиксируется **до** реализации, чтобы бэкенд и фронт собирались
параллельно. Префикс: `/api/guest`. Живой статус: `WS /ws/guest/order/{id}`.

## Тенант и аутентификация

Отель определяется поддоменом (`crystal.guest.localhost`). В деве, где фронт
живёт на `localhost:5183` за vite-прокси, клиент шлёт `X-Hotel-Subdomain:
crystal` — заголовок принимается только при `DJANGO_DEBUG=1`.

Гость получает **непрозрачный токен сессии** и шлёт его как
`Authorization: Bearer <token>`. Токен отзываемый, живёт `GUEST_SESSION_TTL_HOURS`.

Уровень доверия (`trust`) отдаётся клиенту, потому что от него зависит, что
показывать: `anonymous` < `room_scanned` < `pms_verified` < `staff_verified`.
Заказ требует минимум `room_scanned` — то есть гость должен прийти с номером.

## Общие правила

* Суммы — целые, **в минимальных единицах** (копейках). `1 900 ₽` → `190000`.
  Порядок минимальной единицы — `hotel.currency_minor_units` (для рубля `2`,
  это показатель степени, а не множитель).
* Тексты приходят **уже локализованными** строками, а не объектами `{lang: ...}`:
  витрина — не CMS, ей не нужен весь набор переводов. Язык берётся из
  `?lang=`, затем `Accept-Language`, затем языка отеля, затем `en`.
* Время — ISO 8601 с таймзоной. Расписания считаются в TZ отеля.
* Ошибки: `{"detail": "...", "code": "...", "field": "..."}`. `field` — только
  у валидации (422).

---

## 1. Сессия

### `POST /api/guest/session` (без авторизации)

```jsonc
// запрос — любой из вариантов:
{"room_number": "305"}          // ручной ввод или QR со ссылкой /h/crystal/r/305
{"room_number": null}           // «просто посмотреть», без номера
{"room_number": "305", "language": "en"}
```

```jsonc
// 200
{
  "token": "<непрозрачный токен>",
  "session_id": "...",
  "trust": "room_scanned",
  "expires_at": "2026-07-22T02:00:00+00:00",
  "language": "ru",
  "room": "305",
  "hotel": {
    "id": "...", "name": "Отель «Кристалл»", "subdomain": "crystal",
    "currency": "RUB", "currency_minor_units": 2,
    "timezone": "Europe/Moscow", "default_language": "ru",
    "languages": [{"code": "ru", "title": "Русский"}, ...],
    "theme": { /* токены бренда, формат BrandTokens фронта */ }
  }
}
```

**Неизвестный номер** — не «ошибка сервера», а развилка сценария: гость
отсканировал старый QR или ошибся при вводе. Отвечаем так, чтобы UI мог сразу
предложить ручной ввод:

```jsonc
// 404
{"detail": "Номер «999» не найден", "code": "room_not_found",
 "hint": "manual_entry", "hotel": { /* тот же объект, чтобы показать бренд */ }}
```

Сессия без номера создаётся с `trust: "anonymous"` — меню смотреть можно,
заказывать нельзя (см. §5).

### `GET /api/guest/session` — текущая сессия (тот же объект без `token`).

---

## 2. Меню

### `GET /api/guest/menu?include_unavailable=true`

```jsonc
{
  "language": "ru",
  "server_time": "2026-07-21T18:30:00+03:00",   // время отеля, для отсчётов в UI
  "categories": [
    {
      "id": "...", "code": "hot", "title": "Горячее",
      "description": "", "image_url": "http://.../card.webp",
      "sort_order": 0,
      "is_available": true,
      "unavailable_reason": null,          // "schedule" | "inactive"
      "available_from": null,              // "07:00" — если сейчас вне часов
      "available_until": null,
      "items": [
        {
          "id": "...", "code": "ribeye", "category_id": "...",
          "title": "Стейк рибай",
          "description": "Мраморная говядина, 300 г",
          "price": 190000,
          "images": ["http://.../card.webp"],
          "flags": ["chef_choice"],
          "allergens": ["milk"],
          "has_modifiers": true,
          "has_required_modifiers": true,
          "is_available": true,
          "unavailable_reason": null,      // "schedule" | "out_of_stock" | "inactive"
          "available_from": null           // "07:00" — UI пишет «с 07:00»
        }
      ]
    }
  ]
}
```

`available_from` — ближайшее время открытия **в TZ отеля**, `HH:MM`. Именно
поэтому его считает сервер: у гостя в телефоне может быть другая таймзона, и
«с 07:00» по его часам означало бы не то.

Недоступные позиции по умолчанию **не прячутся** (`include_unavailable=true`):
гостю полезнее увидеть «завтрак с 07:00», чем пустой раздел. Но заказать их
нельзя — сервер откажет (§5).

### `GET /api/guest/item/{id}`

Блюдо целиком, с группами модификаторов:

```jsonc
{
  "id": "...", "code": "ribeye", "category_id": "...", "category_title": "Горячее",
  "title": "Стейк рибай", "description": "...", "price": 190000,
  "images": [...], "flags": [...], "allergens": [...],
  "is_available": true, "unavailable_reason": null, "available_from": null,
  "modifier_groups": [
    {
      "id": "...", "code": "doneness", "title": "Прожарка",
      "selection": "single", "is_required": true,
      "min_choices": 1, "max_choices": 1,
      "options": [
        {"id": "...", "code": "medium_rare", "title": "Медиум рэр",
         "price_delta": 0, "is_default": true}
      ]
    }
  ]
}
```

---

## 3. Локации

### `GET /api/guest/locations`

```jsonc
{
  "room": "305",                       // null, если сессия без номера
  "locations": [
    {"id": "...", "code": "in_room", "kind": "in_room", "title": "В номер",
     "requires_refinement": false, "refinement_label": null, "is_default": true},
    {"id": "...", "code": "pool", "kind": "common_point", "title": "У бассейна",
     "requires_refinement": true, "refinement_label": "Номер шезлонга",
     "is_default": false}
  ],
  "delivery_modes": ["delivery", "pickup"]
}
```

`is_default` — `in_room`, когда у сессии есть номер. Гость без номера получает
только общие точки.

---

## 4. Заказ

### `POST /api/guest/order`

Заголовок `Idempotency-Key` **обязателен**: мобильная сеть и нетерпеливый
гость гарантируют повторные отправки.

```jsonc
{
  "lines": [
    {"item_id": "...", "quantity": 2,
     "modifier_option_ids": ["..."], "comment": "без лука"}
  ],
  "location_id": "...",
  "location_refinement": "",            // обязателен, если requires_refinement
  "delivery_mode": "delivery",
  "timing": "asap",                     // "asap" | "scheduled"
  "requested_time": null,               // ISO, обязательно при timing=scheduled
  "comment": "к 19:00"
}
```

Ответ — `201` (или `200` при повторе с тем же ключом) с объектом заказа (§6).

Отказы:

| Код | `code` | Когда |
|---|---|---|
| 400 | `idempotency_key_required` | нет заголовка |
| 409 | `idempotency_conflict` | тот же ключ с другим телом |
| 403 | `trust_required` | сессия без номера (`trust: anonymous`) |
| 422 | `item_unavailable` | позиция вне расписания или в стоп-листе |
| 422 | `modifier_required` | не выбран обязательный модификатор |
| 422 | `refinement_required` | локация требует уточнения |
| 422 | `requested_time_invalid` | время в прошлом или дальше 24 ч |
| 422 | `mixed_categories` | позиции из разных категорий (один заказ — одна точка исполнения) |

`total` считает **сервер** по своим ценам; присланная клиентом сумма
игнорируется. Деньги в этом прогоне не двигаются: `payment_state` = `none`.

---

## 5. История и статус

### `GET /api/guest/orders` → `{"active": [...], "past": [...]}`

Разделение делает сервер: «активный» = статус не терминальный. Клиенту не
нужно знать пресет статусов отеля, чтобы правильно разложить список.

### `GET /api/guest/order/{id}` → объект заказа (§6)

### `POST /api/guest/order/{id}/cancel`

```jsonc
{"reason": "передумал"}   // необязательно
```
`200` с объектом заказа. `409 {"code": "cancel_not_allowed"}`, если текущий
статус этого уже не позволяет (флаг `allows_guest_cancel` в пресете статусов
отеля — «Новый» и «Принят» да, «Готовится» уже нет).

---

## 6. Объект заказа

Один и тот же вид у REST и у WebSocket — чтобы клиент не собирал состояние из
двух разных форматов.

```jsonc
{
  "id": "...", "number": 1,
  "created_at": "2026-07-21T18:30:00+03:00",
  "status": {
    "code": "preparing", "title": "Готовится",
    "sort_order": 2, "is_terminal": false, "is_cancelled": false,
    "color_token": "warning",
    "allows_guest_cancel": false
  },
  "status_flow": [                       // весь пресет отеля — для таймлайна
    {"code": "new", "title": "Новый", "sort_order": 0, "is_cancelled": false},
    ...
  ],
  "history": [
    {"code": "new", "title": "Новый", "at": "2026-07-21T18:30:00+03:00"},
    {"code": "accepted", "title": "Принят", "at": "2026-07-21T18:31:00+03:00"}
  ],
  "room": "305",
  "location": {"code": "in_room", "title": "В номер", "refinement": ""},
  "delivery_mode": "delivery",
  "requested_time": null,
  "eta_minutes": 25,                     // ожидаемое время, оценка сервера
  "comment": "к 19:00",
  "total": 380000, "currency": "RUB",
  "items": [
    {"id": "...", "item_id": "...", "title": "Стейк рибай", "quantity": 2,
     "unit_price": 190000, "line_total": 380000, "comment": "",
     "image_url": "http://.../thumb.webp",
     "modifiers": [{"code": "medium_rare", "title": "Медиум рэр", "price_delta": 0}]}
  ]
}
```

`status_flow` и `history` едут вместе с заказом, чтобы таймлайн рисовался без
второго запроса и без знания пресета отеля на клиенте.

---

## 7. Живой статус (WebSocket)

### `WS /ws/guest/order/{order_id}?token=<токен сессии>&hotel=<поддомен>`

Параметр `hotel` нужен только в деве (у WS нет vite-прокси с заголовками);
в проде поддомен берётся из Host.

**Реконсиляция, а не дельты.** Сразу после `accept` сервер шлёт полный снимок
заказа, и тот же полный снимок — на каждое изменение. Клиент никогда не
«накатывает» изменения на своё состояние: он его заменяет. Это снимает целый
класс багов рассинхрона (пропущенное сообщение, переподключение, гонка с REST).

```jsonc
// сразу после подключения и на каждое событие
{"type": "order.snapshot", "event": "order.status_changed", "order": { /* §6 */ }}

// пинг-понг для удержания соединения
{"type": "ping"} → {"type": "pong"}
```

Коды закрытия: `4401` — токен не подошёл или заказ чужой, `4404` — отель не
определён.

---

## 8. Смена статуса (плюмбинг под трекер)

### `POST /api/orders/{id}/status` — **JWT персонала**, не гостевой токен

```jsonc
{"status": "preparing", "comment": ""}
```

Ответ `200` — объект заказа (§6). Эмитит `order.status_changed` после коммита,
что и приводит к снимку в гостевом WS.

Эндпоинт живёт вне `/api/guest`, потому что это операция персонала. UI трекера
— следующий прогон; здесь он нужен, чтобы живой статус был настоящим и
проверяемым тестом, а не имитацией.
