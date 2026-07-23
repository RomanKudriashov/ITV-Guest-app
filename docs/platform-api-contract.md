# Контракт платформенного API

Платформенный уровень — управление отелями поверх мультитенантности. Работает
на **базовом домене** (без тенант-поддомена). Пишется до кода.

Базовый префикс: `/api/v1/platform`. Аутентификация: `Authorization: Bearer
<JWT>` с клеймом `scope: platform` (супер-админ платформы, `is_platform_admin`,
`hotel = NULL`).

### `POST /platform/auth/login` (без auth)
Вход платформенного админа на базовом домене. Отдельно от `/staff/auth/login`:
у платформенного админа нет тенанта, а staff-логин привязан к отелю.
```jsonc
// запрос {"email":"…","password":"…"}
// ответ 200 { "access","refresh","user":{"id","email","is_platform_admin":true} }
// 401 { "detail","code":"auth_failed" }
```

## Границы и безопасность

* Токен `scope: platform` **не принимается** тенантными CMS-ручками
  (`/api/v1/cms/*`), а тенантный staff-токен **не принимается** платформенными
  ручками. Проверяется в обе стороны.
* Все изменяющие действия пишутся в **AuditLog** (`actor_type=platform`, кто/
  что/когда, `object_type=hotel`).
* `subdomain` — ключ тенанта (напечатаны QR, живут ссылки). **Не редактируется**
  этим API; смена — отдельная осознанная операция (не в этом контракте).
* Impersonation (вход под отель с таймером) — **следующий шаг**, не здесь.

## Модель ответа отеля

```jsonc
// краткий (список)
{ "id","name","subdomain","is_active","created_at",
  "counts": { "rooms": 12, "staff": 4, "items": 30 } }

// профиль (деталь) — то же + :
{ "timezone":"Europe/Moscow","currency":"RUB","default_language":"ru",
  "languages":[ {"code":"ru","title":"Русский","is_default":true} ] }
```

## Ручки

### `GET /platform/hotels`
Список всех отелей (включая деактивированные). Ответ `200`: массив кратких
объектов, сортировка по `created_at` (новые сверху).

### `POST /platform/hotels`
Создать отель — тот же каркас, что у `manage.py create_hotel`.
```jsonc
// запрос
{ "subdomain":"grand", "name":"Grand Hotel", "admin_email":"a@grand.example",
  "timezone":"Europe/Moscow", "currency":"RUB", "languages":["ru","en"],
  "preset":"midnight_navy", "admin_password":"…" /* опц.; иначе сгенерируется */ }
// ответ 201
{ "hotel": {…профиль…},
  "admin": { "email":"a@grand.example", "password":"…" /* показать ОДИН раз;
                                                          есть только если сгенерирован/задан */ } }
// 409 { "detail":"…", "code":"hotel_exists" }  — subdomain занят
// 422 валидация (неизвестный пресет, пустой язык …)
```

### `GET /platform/hotels/{id}`
Профиль отеля. `404`, если отеля нет.

### `PATCH /platform/hotels/{id}`
Правка профиля. Допустимо: `name`, `timezone`, `currency`, `languages`,
`is_active`. **`subdomain` игнорируется/запрещён.** Ответ `200` — профиль.
Деактивация: `{"is_active": false}` → витрина и CMS-логин отеля перестают
резолвиться (middleware отдаёт «отель недоступен»); платформа отель видит.

### `POST /platform/hotels/{id}/admins`
Завести нового hotel-admin или сбросить пароль существующему.
```jsonc
// запрос
{ "email":"a@grand.example", "password":"…" /* опц.; иначе сгенерируется */ }
// ответ 200
{ "email":"a@grand.example", "password":"…" /* показать один раз */ }
```

## Аудит

Каждое действие: `AuditLog.record(action, actor_type=platform,
actor_id=<админ>, object_type="hotel", object_id=<hotel>, payload=…)`.
Действия: `platform.hotel.created`, `platform.hotel.updated`,
`platform.hotel.deactivated`/`activated`, `platform.hotel.admin_set`.
