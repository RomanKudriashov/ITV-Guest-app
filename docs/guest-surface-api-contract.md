# Контракт гостевого контура: главная, отмена, чат, отзывы

Фиксируется **до** реализации. Завершает гостевую поверхность. Префиксы:
`/api/v1/guest`, `/api/v1/tracker`, `/api/v1/cms`. WS: `/ws/v1/guest/chat/`,
`/ws/v1/staff/chat/{thread_id}/`.

## 1. Главная — bento-витрина сервисов

`GET /api/v1/guest/home` — главная это витрина СЕРВИСОВ, а не блюд. Плитки
собираются **из данных** отеля: заведения (точки исполнения с ≥1 активной
категорией), группы-категории при их множестве, инфо, и заглушка управления
номером за флагом.

```jsonc
{
  "hotel": {"name": "...", "subdomain": "crystal"},
  "room": "305",
  "tiles": [
    {
      "key": "panorama",           // стабильный ключ (код точки/группы/служебный)
      "type": "venue",             // venue | service-category | info | room-control
      "title": "Панорама",         // локализовано; для venue — название точки
      "subtitle": "Ресторан",      // подпись рода (venue) | null
      "kind": "kitchen",           // род точки (venue) | null
      "venue_count": null,         // число заведений (только service-category)
      "status": {"state": "open", "until": "23:00", "opens_at": null},
      "image": "https://…/card.webp",   // обложка (каскад) | null → фронт даёт градиент
      "cover_previews": [],        // до 4 обложек внутри свёрнутой плитки-категории
      "route": "/venue/panorama",  // цель перехода | null (disabled)
      "size": "l",                 // s | m | l (наложение CMS)
      "order": 0,                  // порядок показа
      "enabled": true              // false → плитка-заглушка (room-control)
    },
    {"key": "restaurants", "type": "service-category", "title": "Рестораны",
     "venue_count": 5, "cover_previews": ["…","…"], "route": "/category/restaurants",
     "size": "l", "order": 0, "enabled": true},
    {"key": "info", "type": "info", "title": "Об отеле", "route": "/info",
     "size": "s", "order": 4, "enabled": true}
  ],
  "unread_chat": 2,                // непрочитанных сообщений от персонала
  "quick_actions": [ … ]           // сохранены для CMS; новая главная навигирует плитками
}
```

Правила:
- **Заведение = точка исполнения** (ExecutionPoint, в CMS «отдел»). Плитка venue
  — только у точки с ≥1 активной замаршрутизированной категорией.
- **Группировка по порогу** `hotel.showcase_group_threshold` (умолч. 3): точки
  одного рода (рестораны = kitchen+bar, спа, услуги) ≤ порога — отдельные плитки;
  больше — одна `service-category` с `cover_previews`.
- **Обложка** — каскад: фото точки → фото первой её категории → `null` (фронт
  завершает фоном бренда/градиентом).
- **status** считается сервером из расписания точки в TZ отеля; строки пилюли
  («открыто», «до 23:00», «откроется в 07:00», «закрыто») локализует фронт.
- **size/order/показ** переопределяет `ShowcaseTile` (CMS) по `key`; выключенная
  плитка исчезает.

### Уровень 2 — список заведений группы

`GET /api/v1/guest/venues?group=restaurants` — карточки заведений одной группы.

```jsonc
{
  "group": "restaurants",
  "title": "Рестораны",
  "venues": [
    {"code": "panorama", "title": "Панорама", "subtitle": "Ресторан",
     "kind": "kitchen", "image": "…", "status": {"state":"open","until":"23:00"},
     "route": "/venue/panorama"}
  ]
}
```

### Уровень 3 — каталог заведения

`GET /api/v1/guest/catalog?type=product&point=panorama` — тот же эталонный
каталог (§2 guest-api), но суженный до категорий, замаршрутизированных на точку
`panorama`. Без `point` — весь каталог типа, как раньше. `hero_image` при скоупе
— фото ИМЕННО этой точки.

---

## 2. Отмена (консолидация)

Уже работает; приводится к единообразию для всех типов. У объекта заказа
(`§6 guest-api`) — `status.allows_guest_cancel`. Отмена:
`POST /api/v1/guest/order/{id}/cancel {reason?}`. Для `slot` освобождает слот
(готово). `409 cancel_not_allowed`, если статус уже не позволяет.

---

## 3. Чат гость ↔ персонал

### Модель

**Тред — на номер** (когда есть), иначе на сессию: чат живёт «при комнате», а
не при заявке, и переживает переоформление заказов.

`ChatThread`: `room?`, `guest_session?`, `execution_point?` (кому
маршрутизируется, по умолчанию — общий тред отеля / ресепшн), `last_message_at`.

`ChatMessage`: `thread`, `author_type` (`guest`|`staff`), `author_id?`,
`body`, `created_at`, `read_by_staff_at?`, `read_by_guest_at?`.

### Гость (REST + WS)

| Метод | Путь |
|---|---|
| GET | `/api/v1/guest/chat` | текущий тред + сообщения (создаёт тред при первом обращении) |
| POST | `/api/v1/guest/chat` | `{body}` — отправить сообщение |
| POST | `/api/v1/guest/chat/read` | отметить прочитанными сообщения персонала |

`WS /ws/v1/guest/chat/?token=<гостевой>&hotel=<subdomain>&lang=ru` —
**реконсиляция снимком**: полный снимок треда при подключении и после каждого
сообщения (любой стороны). Формат снимка = тело `GET /api/v1/guest/chat`.

### Персонал (REST + WS)

| Метод | Путь |
|---|---|
| GET | `/api/v1/tracker/chat/threads` | треды отеля (последнее сообщение, непрочитанные) |
| GET | `/api/v1/tracker/chat/threads/{id}` | тред + сообщения |
| POST | `/api/v1/tracker/chat/threads/{id}` | `{body}` — ответить |
| POST | `/api/v1/tracker/chat/threads/{id}/read` | отметить прочитанными сообщения гостя |

`WS /ws/v1/staff/chat/{thread_id}/?token=<JWT>&hotel=&lang=` — тот же снимок.

**У WS нет middleware** — авторизация/скоуп/язык резолвятся явно:
гостевой токен ↔ **только свой** тред; сотрудник ↔ только треды **своего
отеля**. Коды закрытия: `4401` токен, `4403` чужой тред, `4404` отель.

Новое сообщение эмитит событие после коммита → уведомление получателю через
существующие каналы, без новой инфраструктуры.

### Снимок треда

```jsonc
{
  "thread_id": "...", "room": "305",
  "messages": [
    {"id": "...", "author_type": "guest", "author_name": "Гость",
     "body": "Когда завтрак?", "created_at": "...", "mine": true}
  ],
  "unread": 0            // непрочитанных для запрашивающей стороны
}
```

`mine` вычисляется по стороне запроса (гость видит свои как mine, персонал —
свои).

---

## 4. Отзывы

Приватные по умолчанию: оценка уходит отелю, **гостям не публикуется**.

### Гость

Объект заказа получает `can_review` (терминальный, не отменён, отзыва ещё нет,
и у отеля включён сбор отзывов).

| Метод | Путь |
|---|---|
| GET | `/api/v1/guest/order/{id}/review` | отзыв, если оставлен; `404`, если ещё нет (сценарий «не оценивал», витрина показывает форму) |
| POST | `/api/v1/guest/order/{id}/review` | `{rating: 1..5, comment?}` |

Один отзыв на заказ (идемпотентно): повтор — `409 review_exists`.
Отзыв до завершения заказа — `422 review_not_allowed`.

### Персонал / CMS

| Метод | Путь |
|---|---|
| GET | `/api/v1/tracker/order/{id}` | объект заказа получает блок `review` |
| GET | `/api/v1/cms/reviews?rating=&limit=` | список отзывов отеля |

### Настройка отеля (CMS)

`GET/PATCH /api/v1/cms/review-settings`:
```jsonc
{"enabled": true, "low_rating_threshold": 3}
```
`low_rating_threshold` — оценка `≤ порога` эмитит событие → уведомление
менеджеру через существующие каналы уведомлений (service recovery до того, как гость уехал).

---

## 5. RLS и изоляция

Новые таблицы (`chat_thread`, `chat_message`, `review`) — тенант-скоуп + RLS.
Гость видит только свой тред и свои отзывы; сотрудник — только своего отеля.
Сторож `test_rls_coverage` должен остаться зелёным.
