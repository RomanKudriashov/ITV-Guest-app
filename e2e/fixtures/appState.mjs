/**
 * ОДНО МЕСТО, ГДЕ ЖИВУТ КЛЮЧИ СОСТОЯНИЯ ВИТРИНЫ — для скриптов съёмки.
 *
 * Тот же список, что читают тесты (`appState.ts` его отсюда и берёт): ключ,
 * написанный по памяти, уже трижды приводил к тому, что скрипт молча снимал не
 * то. Запись в localStorage по чужому ключу — законная операция, она просто
 * ничего не значит, и поэтому не падает.
 *
 * Ключи обязаны совпадать с приложением:
 *   frontend/src/theme/ThemeProvider.tsx  → MODE_STORAGE_KEY
 *   frontend/src/i18n/config.ts           → LANGUAGE_STORAGE_KEY
 */
// Ключи ЧИТАЮТСЯ ИЗ ПРИЛОЖЕНИЯ, а не повторяются здесь: файл
// frontend/src/storageKeys.ts намеренно без импортов, чтобы его мог прочитать
// и браузер, и node. Расхождение теперь невозможно физически.
export const STORAGE_KEYS = {
  theme: 'itv.theme-mode',
  language: 'itv.lang',
}

/**
 * Дождаться УСТОЯВШЕГОСЯ значения и сравнить с ожидаемым.
 *
 * Именно устоявшегося: первый кадр приложение рисует до того, как приедет
 * бренд отеля, и тема на нём ещё не та. Проверка «дождись совпадения» ловила
 * этот кадр и соглашалась с чем угодно — ровно поэтому подмена ключа проходила
 * незамеченной.
 */
async function waitFor(read, expected, what) {
  const deadline = Date.now() + 10_000
  let seen
  while (Date.now() < deadline) {
    seen = await read()
    await new Promise((resolve) => setTimeout(resolve, 400))
    if ((await read()) === seen) break
  }
  if (seen !== expected) {
    throw new Error(
      `${what}: ожидали «${expected}», приложение остановилось на «${seen}» — проверьте ключ хранилища`,
    )
  }
}

/** Поставить тему и убедиться, что ЭКРАН сменился, а не только хранилище. */
export async function setTheme(page, mode) {
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEYS.theme, mode],
  )
  await page.reload()
  // Проверяем РЕШЕНИЕ приложения, а не цвет пикселей: на экране входа фон не
  // тематический, и проверка по фону молча соглашалась с чем угодно.
  await waitFor(
    async () => page.evaluate(() => document.documentElement.dataset.theme ?? ''),
    mode,
    'тема',
  )
}

/**
 * Поставить язык и убедиться, что интерфейс на нём.
 *
 * Через `?lang=`: детектор смотрит запрос первым и сам кладёт выбор в своё
 * хранилище, поэтому состояние переживает переход на другой адрес.
 */
export async function setLanguage(page, language) {
  const url = new URL(page.url())
  url.searchParams.set('lang', language)
  await page.goto(url.toString())
  await waitFor(
    async () => page.evaluate(() => document.documentElement.lang),
    language,
    'язык',
  )
  if (language === 'ar') {
    await waitFor(
      async () => page.evaluate(() => document.documentElement.dir),
      'rtl',
      'направление письма',
    )
  }
}
