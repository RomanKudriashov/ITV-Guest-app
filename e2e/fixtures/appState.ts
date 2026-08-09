import { expect, type Page } from '@playwright/test'


/**
 * ОДНО МЕСТО, ГДЕ ЖИВУТ КЛЮЧИ СОСТОЯНИЯ ВИТРИНЫ.
 *
 * Зачем это существует. Скрипты и тесты трижды молча проверяли не то, потому
 * что ключ хранилища был написан по памяти:
 *
 *   `i18nextLng` вместо `itv.lang`      — детектор языка по умолчанию читает
 *      свой ключ, а приложение хранит выбор в своём. Скрипт снял четыре
 *      «языковых» комплекта, и все четыре были русскими.
 *   `itv.theme` вместо `itv.theme-mode` — кадры «в светлой теме» снимались в
 *      тёмной, и разницы никто не видел, потому что её и не было.
 *
 * Ни один из случаев не упал: запись в localStorage по чужому ключу — законная
 * операция, она просто ничего не значит. Поэтому здесь не только имена ключей,
 * но и ПРОВЕРКА, что состояние доехало до экрана.
 *
 * Ключи обязаны совпадать с приложением:
 *   frontend/src/theme/ThemeProvider.tsx  → MODE_STORAGE_KEY
 *   frontend/src/i18n/config.ts           → LANGUAGE_STORAGE_KEY
 */
// Значения берутся из .mjs-близнеца, чтобы список ключей существовал в ОДНОМ
// экземпляре: скрипты съёмки запускаются простым node и типов не понимают.
export { STORAGE_KEYS } from './appState.mjs'
import { STORAGE_KEYS } from './appState.mjs' 

export type ThemeMode = 'dark' | 'light'
export type Language = 'ru' | 'en' | 'ar' | 'zh'

/**
 * Поставить тему и УБЕДИТЬСЯ, что она применилась.
 *
 * Проверка идёт по тому, что приложение РЕШИЛО показать, а не по значению в
 * хранилище: записать можно что угодно, а вопрос всегда один — приняло ли.
 */
/** Тема, на которой приложение остановилось: два одинаковых чтения подряд. */
async function settledTheme(page: Page): Promise<string> {
  const read = () => page.evaluate(() => document.documentElement.dataset.theme ?? '')
  const deadline = Date.now() + 10_000
  let seen = await read()
  while (Date.now() < deadline) {
    await page.waitForTimeout(400)
    const again = await read()
    if (again === seen) return seen
    seen = again
  }
  return seen
}

export async function setTheme(page: Page, mode: ThemeMode): Promise<void> {
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEYS.theme, mode] as const,
  )
  await page.reload()

  // Проверяем РЕШЕНИЕ приложения (data-theme на <html>), а не цвет пикселей:
  // на экране входа фон не тематический, и проверка по фону молча соглашалась
  // с чем угодно — именно она пропустила съёмку «светлой темы» в тёмной.
  // УСТОЯВШЕЕСЯ значение, а не первое совпавшее: первый кадр приложение рисует
  // до того, как приедет бренд отеля, и тема на нём ещё не та. Проверка
  // «дождись совпадения» ловила этот кадр — и подмена ключа проходила мимо.
  const settled = await settledTheme(page)
  expect(
    settled,
    `тема ${mode} записана, но приложение остановилось на «${settled}» — проверьте ключ ${STORAGE_KEYS.theme}`,
  ).toBe(mode)
}

/**
 * Поставить язык и УБЕДИТЬСЯ, что интерфейс на нём.
 *
 * Через `?lang=`, а не записью в хранилище: детектор смотрит запрос ПЕРВЫМ и
 * сам кладёт выбор в своё хранилище — так состояние переживает переход на
 * другой адрес. Проверка — по атрибуту `lang` документа: он и есть то, что
 * приложение реально решило показать.
 */
export async function setLanguage(page: Page, language: Language): Promise<void> {
  const url = new URL(page.url())
  url.searchParams.set('lang', language)
  await page.goto(url.toString())

  await expect
    .poll(async () => page.evaluate(() => document.documentElement.lang), {
      timeout: 10_000,
      message: `язык ${language} запрошен, но интерфейс остался прежним — проверьте ключ ${STORAGE_KEYS.language}`,
    })
    .toBe(language)

  // Арабский обязан ещё и развернуть раскладку: язык без направления —
  // половина перевода.
  if (language === 'ar') {
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dir), { timeout: 10_000 })
      .toBe('rtl')
  }
}
