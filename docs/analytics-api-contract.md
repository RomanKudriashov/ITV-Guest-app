# Контракт аналитики (прогон 11, финал MVP)

Аналитика отеля: сбор через событийную шину в предагрегаты, дашборд читает
готовое. Контракт — до кода.

## Принцип сбора

**Не считаем на лету по живым заказам.** Каждое доменное событие
(`order.created/accepted/status_changed/cancelled`, `review.low`, а также новый
`session.started`) проходит через один вход `record_event(...)`, который:

1. Пишет **сырое событие** в append-only журнал `analytics_event` (дедуп по
   `event_id` — id события шины). Повтор того же события — no-op.
2. Только для НОВОЙ строки применяет **редьюсер** `apply(raw_event)` —
   инкременты в дневные агрегаты.

Дашборд читает **только агрегаты** (и справочные таблицы для имён измерений),
живые заказы не сканирует.

### Идемпотентность и пересчёт — by construction

Редьюсер читает **только** денормализованный слепок в сырой строке
(`dimensions` + `measures`), не живые заказы. Поэтому:

* **Идемпотентность:** дедуп `event_id` → инкремент применяется ровно один раз.
* **Пересчёт** (`recompute`): обнулить агрегаты отеля (или диапазон дат) и
  прогнать тот же `apply(...)` по всем сырым строкам. Тот же редьюсер над теми же
  данными ⇒ **те же числа**. Живая агрегация и пересчёт совпадают не по удаче, а
  по устройству.

### Часовой пояс

День группировки — **сутки отеля** (`hotel.tzinfo`), не UTC. `business_date`
считается из `occurred_at` один раз при записи сырого события и хранится в строке;
все агрегаты и запросы группируются по нему. Тесты самодостаточны по времени.

## Измерения (dimensions)

| Измерение | Источник | Значения |
|---|---|---|
| `offering_type` | `Category.type` (реестр, не форк) | product / service_request / info / slot |
| `execution_point_id` | `Order.execution_point` | отдел |
| `location_id` | `Order.location` | локация доставки (nullable) |
| `entry_method` | `GuestSession.trust` | anonymous / room_scanned / pms_verified / staff_verified |
| `device` | из `GuestSession.user_agent` | mobile / tablet / desktop / unknown |
| `language` | `GuestSession.language` | ru / en / ar / zh / '' |
| `item_id`, `category_id` | строки заказа | для товарных срезов |
| `modifier_code` | `OrderItem.modifiers_snapshot` | популярные модификаторы |
| `room` / `floor` | `Order.room` | для drill-down (в сырой строке) |

`offering_type` — это значение поля данных, а не ветка кода: агрегируем
группировкой по `category.type`, нигде не сравнивая строку типа.

## Агрегатные таблицы (дневные роллапы)

Все — `TenantModel` (+ автоскоуп + RLS). Уникальность по `(hotel, business_date,
<измерения>)`; инкремент через `update_or_create` + F-выражения.

* **`analytics_event`** — сырой журнал. `event_id` (uniq/hotel), `name`,
  `occurred_at`, `business_date`, `order_id?`, `subject_id?`, `dimensions` JSON,
  `measures` JSON.
* **`analytics_order_daily`** — грань: дата × `offering_type` ×
  `execution_point_id` × `location_id` × `entry_method` × `device` × `language`.
  Меры: `orders_count`, `revenue_minor`, `items_count`, `cancelled_count`,
  `completed_count`, `off_hours_count`, `reaction_seconds_sum`, `reaction_count`,
  `fulfil_seconds_sum`, `fulfil_count`.
  Все меры атрибутируются **дате создания заказа**, поэтому `orders_count` не
  двоится по мере смены статуса; исход отражают счётчики
  `completed`/`cancelled`, среднее время реакции/выполнения — суммы+счётчики.
* **`analytics_item_daily`** — дата × `item_id` (+ `category_id`,
  `offering_type`). Меры: `quantity`, `revenue_minor`, `orders_count`.
* **`analytics_modifier_daily`** — дата × `modifier_code`. Меры: `quantity`.
* **`analytics_session_daily`** — дата × `entry_method` × `device` × `language`.
  Меры: `sessions_count`, `converted_count` (сессия, оформившая ≥1 заказ —
  атрибутируется дате старта сессии; решение «первый заказ» фиксируется в мерах
  сырого события, поэтому пересчёт повторяет его точь-в-точь).
* **`analytics_review_daily`** — дата × `execution_point_id` × `offering_type`.
  Меры: `reviews_count`, `rating_sum`, `low_count`.
* **`analytics_export`** — задача экспорта: `status`
  (pending/running/ready/failed), `format` (csv/xlsx), `params` JSON,
  `file` путь, `row_count`, `error`.

**Эскалации** и **заполняемость слотов** не пре-агрегируются: срабатывания
эскалации берутся из уже персистентного `notifications_log`
(`escalation_step` не пуст) по дате отеля; ёмкость слотов — из `SlotConfig` в
момент запроса. Спрос по слотам — это `item_daily.quantity` для slot-позиций.

## Эндпоинты (CMS, `auth=StaffAuth`)

Монтируются под `/api/v1/cms/analytics`. Скоуп прав — внутри, теми же привязками,
что и трекер (`StaffAssignment`).

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/analytics/summary` | карточки-итоги за период (+ сравнение) |
| GET | `/analytics/timeseries` | динамика по дню/часу/неделе |
| GET | `/analytics/breakdown` | разбивка по измерению (таблица) |
| GET | `/analytics/operations` | реакция/выполнение/отмены/эскалации/загрузка |
| GET | `/analytics/traffic` | сессии/источник/устройство/язык/конверсия |
| GET | `/analytics/reviews` | средняя оценка, доля низких, динамика |
| GET | `/analytics/drilldown` | список конкретных заявок под срезом |
| POST | `/analytics/export` | поставить экспорт среза (Celery) → `{id}` |
| GET | `/analytics/export/{id}` | статус; когда `ready` — ссылка на файл |
| GET | `/analytics/scope` | что доступно пользователю (точки, отели) |

### Общие query-параметры

* `date_from`, `date_to` (даты отеля, включительно) ИЛИ `preset`
  (`today`/`week`/`month`).
* `compare=previous` — добавить тот же по длине предыдущий период; в ответе
  `current` и `previous` + дельты.
* Фильтры по любому измерению: `type`, `category_id`, `item_id`, `point_id`,
  `location_id`, `entry_method`, `device`, `language`, `floor`, `room`, `status`
  (последние два/`status` применяются к drill-down по живым заказам).
  Фильтры **комбинируются** (AND).
* `dimension=` (для `/breakdown`) — по какому измерению разбить.
* `granularity=` (для `/timeseries`) — `hour`/`day`/`week`.
* `sort=`, `order=asc|desc` — сортировка таблиц по любому столбцу.
* `group=` (для `/timeseries`, `/operations`) — по отделу и т.п.

### Ответы (форма)

```jsonc
// GET /analytics/summary?preset=week&compare=previous
{
  "period": {"from": "2026-07-14", "to": "2026-07-20", "tz": "Europe/Moscow"},
  "current":  {"orders": 128, "revenue_minor": 452000, "avg_check_minor": 3531,
               "items_per_order": 2.1, "completed_rate": 0.86, "cancel_rate": 0.07,
               "avg_reaction_seconds": 190, "avg_fulfil_seconds": 1240,
               "avg_rating": 4.4, "low_review_rate": 0.08,
               "sessions": 410, "conversion": 0.31},
  "previous": { /* те же поля */ },
  "delta":    {"orders": 0.12, "revenue_minor": 0.09 /* доли изменения */ }
}
```

```jsonc
// GET /analytics/breakdown?dimension=item&preset=month&sort=revenue_minor&order=desc
{"dimension": "item",
 "rows": [{"key": "<item_id>", "label": "Салат «Цезарь»", "orders": 40,
           "quantity": 55, "revenue_minor": 132000, "share": 0.29}]}
```

```jsonc
// GET /analytics/drilldown?type=slot&status=cancelled&date_from&date_to
{"orders": [{"id","number","type","point","status","total_minor","created_at",
             "room","rating"}], "total": 12}
```

## Права (существующая модель)

* `is_platform_admin` — все отели, сравнение между отелями (`hotel=`).
* `is_hotel_admin` — весь свой отель (все точки).
* Иначе — **только назначенные точки** (`assigned_points(user)`). Все агрегатные
  запросы фильтруются `execution_point_id ∈ scope`; заказ без точки виден только
  админу отеля. `/analytics/scope` отдаёт доступный набор, фронт не гадает.
* Тенант-изоляция — RLS: отель A не видит строк отеля B даже сырым SQL.

## Экспорт

`POST /analytics/export` кладёт задачу в Celery (тяжёлое — не в запросе),
возвращает `{id, status: "pending"}`. Воркер выполняет тот же запрос среза,
рендерит CSV или XLSX (xlsx пишется без внешних зависимостей — это zip из XML),
ставит `ready` + `row_count`. Клиент поллит `GET /analytics/export/{id}`; при
`ready` в ответе поле `file` — прямая ссылка на скачивание
(`/analytics/export/{id}/download`). Готовый файл хранится на строке задачи,
поэтому скачивание не зависит от внешнего хранилища.

## Сид

Под флагом `--with-analytics-history` (по образцу `--with-guest-history`):
несколько недель правдоподобной истории (все 4 типа, разные отделы/локации/
статусы/отмены/отзывы, разброс по часам и дням). Пишет реальные заказы →
события → агрегаты. По умолчанию ВЫКЛ: история сдвигает нумерацию заказов, на
которую опираются тесты.

## Границы

Только аналитика. Без оплаты/PMS, ТВ, WhatsApp, бэкапов/мониторинга/rate
limiting.
