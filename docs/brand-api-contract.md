# Контракт бренд-настроек (прогон 7)

Фиксируется **до** реализации. Префикс: `/api/v1/cms`. Аутентификация и тенант —
как у остальной CMS.

## Зачем и главный принцип

Отель крутит токены, а рядом — **живое превью реальной гостевой витрины**,
перекрашивающееся по черновым токенам до сохранения. Ключевое: превью и
рантайм используют **один и тот же** механизм темы (`createAppTheme` из
токенов). Не макет, не картинка — те же компоненты, что увидит гость.

Сохранённые токены уже отражаются в гостевом ответе: `POST /api/v1/guest/session`
и `GET /api/v1/guest/*` отдают `hotel.theme` из `BrandTheme` отеля. Этот прогон
добавляет их редактирование, не меняя канал доставки.

## Форма токенов

Расширяет существующую `BrandTokens` (`frontend/src/theme/tokens.ts`) — новые
разделы **опциональны**, старые компоненты их игнорируют:

```jsonc
{
  "preset": "evening_concierge",          // код применённого пресета (или "custom")
  "palette": { "light": { /*...*/ }, "dark": { /*...*/ } },
  "typography": {
    "fontFamily": "'Manrope', sans-serif",
    "headingFontFamily": "'Cormorant Garamond', serif",
    "fontSizeBase": 16, "fontWeightRegular": 400, "fontWeightMedium": 500,
    "fontWeightBold": 700, "headingScale": 1.0
  },
  "shape": { "borderRadius": 14, "borderRadiusLarge": 22 },
  "spacingUnit": 8,
  "brand": {
    "logoLight": "http://.../logo-light.webp",   // на светлом фоне
    "logoDark":  "http://.../logo-dark.webp",     // на тёмном фоне
    "surfaceStyle": "soft",                        // flat | soft | glass
    "defaultMode": "light",                        // light | dark | system
    "background": {
      "kind": "solid",                             // solid | gradient | image | abstraction
      "color": "#0E1B2A",                          // для solid — иначе palette.background
      "gradient": {"from": "#0E1B2A", "to": "#16324A", "angle": 160},
      "imageUrl": "http://.../bg.webp",            // для kind=image
      "abstraction": "linen",                      // код паттерна из библиотеки
      "dim": 0.45                                  // авто-затемнение поверх картинки, 0..1
    }
  }
}
```

`surfaceStyle` — как рисуются карточки/шторки: `flat` (без тени), `soft`
(мягкая тень, скругления), `glass` (полупрозрачность + блюр). Читается фронтом
при сборке темы.

Шрифты берутся **только из курируемого списка** (`GET /brand/fonts`): свои
файлы шрифтов отель не грузит — это вопрос лицензий и стабильности рендера.

---

## 1. Текущий бренд

### `GET /api/v1/cms/brand`

```jsonc
{
  "id": "...",
  "name": "Отель «Кристалл» — основная",
  "preset": "evening_concierge",
  "tokens": { /* см. выше — полный набор */ },
  "updated_at": "2026-07-22T10:00:00+03:00"
}
```

### `PATCH /api/v1/cms/brand`

Тело — частичные токены (deep-merge на сервере поверх текущих). Отель правит
что угодно, не пересобирая весь набор:

```jsonc
{"tokens": {"palette": {"light": {"primary": "#0F766E"}},
            "brand": {"surfaceStyle": "glass"}}}
```

Ответ — тот же объект, что у `GET`. Валидация:
* цвета — строки `#RGB`/`#RRGGBB`/`rgb()/rgba()` — иначе `422 invalid_color`
  с `field`;
* `surfaceStyle`/`defaultMode`/`background.kind` — из допустимых значений;
* `headingFontFamily`/`fontFamily` — только из `GET /brand/fonts`, иначе
  `422 font_not_allowed`;
* `background.dim` — `0..1`.

Любая правка через PATCH ставит `preset: "custom"` (если только не пришёл сам
`preset`): как только отель тронул токен вручную, набор перестаёт быть
«чистым пресетом».

---

## 2. Пресеты

### `GET /api/v1/cms/brand/presets`

Библиотека цельных наборов (по брендбуку). Выбор пресета = полный набор
токенов, дальше отель правит.

```jsonc
{
  "presets": [
    {
      "code": "evening_concierge",
      "name": "Вечерний консьерж",
      "description": "Тёмный, тёплое золото, спокойный люкс",
      "swatch": ["#0E1B2A", "#C8A24A", "#16324A"],   // для плитки выбора
      "default_mode": "dark",
      "tokens": { /* полный набор */ }
    },
    {"code": "marble_linen",   "name": "Мрамор и лён",     ...},
    {"code": "tiffany_night",  "name": "Тиффани-ночь",     ...},
    {"code": "azure_light",    "name": "Светлый лазурный", ...}
  ]
}
```

### `POST /api/v1/cms/brand/apply-preset`

```jsonc
{"preset": "tiffany_night"}
```
Заменяет токены отеля набором пресета целиком и возвращает объект бренда.
Это отдельный эндпоинт, а не `PATCH`, потому что смысл другой: не «поправить»,
а «начать с чистого набора». `404 unknown_preset` — если кода нет.

---

## 3. Фоны-абстракции

### `GET /api/v1/cms/brand/abstractions`

Встроенная библиотека паттернов-подложек (поставляем мы). Отель выбирает по
коду — файлы не грузит.

```jsonc
{
  "abstractions": [
    {"code": "linen",  "name": "Лён",    "preview_url": "/static/abstractions/linen.svg"},
    {"code": "waves",  "name": "Волны",  "preview_url": "..."},
    {"code": "marble", "name": "Мрамор", "preview_url": "..."},
    {"code": "mesh",   "name": "Сетка",  "preview_url": "..."}
  ]
}
```

---

## 4. Загрузка лого и фона

Через существующий медиапайплайн (`POST /api/v1/cms/media`, `kind=brand`).

Клиент грузит файл → получает `id` и (после обработки) `url` → кладёт этот
url в токены: `brand.logoLight`, `brand.logoDark` или `brand.background.imageUrl`
и сохраняет через `PATCH /brand`.

Фоновая картинка получает авто-затемнение не на бэке, а токеном
`background.dim`: витрина рисует затемняющий слой поверх, чтобы текст читался
на любой картинке. Так одна и та же картинка годится и для светлой, и для
тёмной темы.

---

## 5. Курируемые шрифты

### `GET /api/v1/cms/brand/fonts`

```jsonc
{
  "fonts": [
    {"family": "'Manrope', sans-serif",            "name": "Manrope",  "category": "sans"},
    {"family": "'Inter', sans-serif",              "name": "Inter",    "category": "sans"},
    {"family": "'Cormorant Garamond', serif",      "name": "Cormorant","category": "serif"},
    {"family": "'Playfair Display', serif",        "name": "Playfair", "category": "serif"},
    {"family": "'Manrope', sans-serif",            ...}
  ]
}
```

`family` — ровно та строка, что уходит в `typography.fontFamily`. Список
курируемый: и `fontFamily`, и `headingFontFamily` в PATCH проверяются по нему.
