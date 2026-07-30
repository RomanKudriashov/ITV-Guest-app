# Module Registry API — контракт

Реестр модулей отеля: какие платные фичи включены — по тарифу или точечным
исключением. **R1 — только данные + API.** Управляющий UI — R6, гейтинг
CMS-навигации — R4. Именно этот реестр решает, что отель видит в своей CMS:
без модуля отель не видит ни одного его экрана.

Управление реестром — на **платформенном** уровне (`/api/v1/platform`, `PlatformAuth`).
Отель свой реестр только **читает** (`/api/v1/cms/modules`, `StaffAuth`) — для гейтинга.

## Модель

`HotelModule` (тенант-таблица, RLS): `code`, `is_enabled`, `source`, `config`.
`Hotel.tariff` — строка-пометка уровня (шов биллинга; деньги вне системы).

### Коды модулей (`code`)
`room_control` (GRMS) · `payment` · `pms` · `mobile_key` · `multi_restaurant` ·
`marketing` · `extra_languages` · `native_app` · `analytics_level`.

### Источник (`source`)
- `tariff` — включён тарифом (по умолчанию).
- `override` — выдан точечно вне тарифа (пилоту).

`config` — произвольный JSON под модуль (напр. `{"level": "advanced"}` для
`analytics_level`).

## Эндпоинты

### `GET /api/v1/platform/hotels/{hotel_id}/modules`
Полный реестр: **все** известные модули, включённые и нет (отсутствующая строка →
`{is_enabled: false, source: "tariff", config: {}}`).

```json
{
  "tariff": "resort",
  "modules": [
    {"code": "multi_restaurant", "is_enabled": true,  "source": "tariff",   "config": {}},
    {"code": "pms",              "is_enabled": true,  "source": "override", "config": {"node": "local-1"}},
    {"code": "payment",          "is_enabled": false, "source": "tariff",   "config": {}}
  ]
}
```

### `PUT /api/v1/platform/hotels/{hotel_id}/modules`
Upsert строк реестра по коду (частичный список допустим — обновляет только
переданные). Неизвестные коды и источники игнорируются. Опционально задаёт
`tariff`. Пишет `AuditLog`. Возвращает полный реестр (как GET).

```json
{
  "tariff": "resort",
  "modules": [
    {"code": "multi_restaurant", "is_enabled": true},
    {"code": "pms", "is_enabled": true, "source": "override", "config": {"node": "local-1"}}
  ]
}
```

### `GET /api/v1/cms/modules`  (StaffAuth — отель, только чтение)
Тот же shape, что и платформенный GET. Отель не редактирует реестр — только видит,
что ему включено. Основа для гейтинга навигации CMS (R4).

## Инварианты
- Реестр всегда отдаёт полный набор кодов — клиенту не нужно знать, какие строки
  заведены.
- Значения по умолчанию: выключено, источник `tariff`, пустой `config`.
- Изоляция тенанта — RLS: строки одного отеля не видны из другого.
