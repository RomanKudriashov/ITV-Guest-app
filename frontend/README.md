# ITV Guest App — Frontend

Guest web app for hotels (order food & services by scanning a QR code).
Multi-tenant SaaS: every hotel gets its own brand tokens, language set and direction.

Stack: React 18, MUI v6, Vite 5, TypeScript, i18next. Package manager: **npm** (no pnpm).

## Structure

```
frontend/
  index.html
  vite.config.ts          # dev server (0.0.0.0:5173), polling watch, /api + /ws proxy
  Dockerfile              # node:20-alpine, npm run dev
  src/
    main.tsx              # entry: i18n -> AppThemeProvider -> App
    App.tsx               # temporary demo page (theme / i18n / RTL proof)
    theme/
      tokens.ts           # BrandTokens contract + DEFAULT_BRAND_TOKENS + mergeBrandTokens
      createAppTheme.ts   # BrandTokens -> MUI Theme
      ThemeProvider.tsx   # tokens/mode/direction, emotion cache (RTL), CssBaseline, useAppTheme()
      index.ts
    i18n/
      config.ts           # i18next init, LanguageDetector, RTL_LANGUAGES, directionForLanguage
      locales/{en,ru,ar,zh}.json
```

There are **no product screens yet** — only the foundation.

## Running

Locally:

```bash
npm install
cp .env.example .env      # optional
npm run dev               # http://localhost:5173
```

Via docker-compose (service is maintained outside this folder):

```bash
docker compose up frontend
```

The dev server binds `0.0.0.0:5173`, uses polling file watch and `hmr.clientPort: 5173`
so HMR works through a container port mapping. `/api` and `/ws` are proxied to
`VITE_API_PROXY` (default `http://localhost:8000`; in compose set `http://backend:8000`).

Scripts: `dev`, `build` (`tsc && vite build`), `preview`, `typecheck`.

## Project rule: colors only from tokens

**No hardcoded color may appear anywhere outside `src/theme/tokens.ts`.**
No `#hex`, `rgb()`, or named colors in components, `sx` props or styles.
Use theme-driven values instead:

```tsx
<Box sx={{ bgcolor: 'background.paper', color: 'text.secondary' }} />
```

If a color you need doesn't exist, add it to `BrandColorSet` in `tokens.ts` (both
`light` and `dark`), map it in `createAppTheme.ts`, then consume it from the theme.

## How a hotel overrides tokens

`BrandTokens` (palette light/dark, typography, shape, spacingUnit) are per-hotel and
will be delivered by the backend. A hotel sends a **partial** override which is merged
onto `DEFAULT_BRAND_TOKENS`:

```tsx
<AppThemeProvider brandTokens={{ hotelId: 'h-42', palette: { light: { primary: '#8A1538' } } }}>
```

At runtime the same can be done through `useAppTheme().setBrandTokens(override)` once
the tokens endpoint responds. `mergeBrandTokens()` in `tokens.ts` is the single merge point.

## How to add a language

1. Add `src/i18n/locales/<lng>.json` (copy `en.json`, translate all keys).
2. Register it in `src/i18n/config.ts`: `SUPPORTED_LANGUAGES`, `LANGUAGE_LABELS`, `resources`.
3. If the language is right-to-left, add its code to `RTL_LANGUAGES`
   (`ar`, `he`, `fa`, `ur` are already there). Nothing else is needed —
   `ThemeProvider` reacts to the i18next language change, flips `direction`,
   swaps the emotion cache to `stylis-plugin-rtl` and updates `document.dir` / `lang`.

Language is auto-detected in order: `?lang=` querystring → `localStorage` → browser
`navigator` settings, with `en` as the fallback.
