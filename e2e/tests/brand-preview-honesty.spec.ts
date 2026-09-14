import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { ADMIN, API, apiToken, HOTEL, login } from './helpers'

/**
 * ПАРТИЯ 7, ЗАХОД 1: ПОКАЗ БРЕНДА НЕ ВЫДУМЫВАЕТ.
 *
 * Проверки идут по ЖИВОМУ стенду: показ берёт каталог отеля через ту же ручку,
 * что и остальная панель, и рисует шапку тем же кодом, что витрина. Мок
 * доказал бы, что экран умеет рисовать, и промолчал бы о том, ЧТО он рисует —
 * а весь смысл правки в этом.
 */

async function openBrand(page: Page): Promise<void> {
  await login(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-preview')).toBeVisible({ timeout: 25_000 })
}

/** Названия позиций отеля — то, что показ ОБЯЗАН показывать вместо выдумки. */
async function realTitles(request: APIRequestContext): Promise<string[]> {
  const token = await apiToken(request, ADMIN)
  const response = await request.get(`${API}/api/cms/items?limit=8`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const rows = (Array.isArray(body) ? body : body.items) as { title: Record<string, string> }[]
  return rows.map((row) => Object.values(row.title ?? {})[0]).filter(Boolean)
}

test.describe('Показ бренда: честность данных', () => {
  test('в показе нет ни одной выдуманной позиции', async ({ page }) => {
    await openBrand(page)

    /*
      ИМЕНА КОНСТАНТ ПРОВЕРЯЮТСЯ БУКВАЛЬНО.

      Это те самые три выдумки, которые жили в показе: две подменяли каталог
      молча, третья не заменялась никогда. Проверка держится за их имена, а не
      за «что-нибудь английское»: так она переживёт перевод интерфейса и
      упадёт ровно тогда, когда кто-нибудь вернёт константу обратно.
    */
    const frame = page.getByTestId('brand-preview')
    for (const invented of ['Ribeye Steak', 'Caesar Salad', 'Vanilla Pavlova']) {
      await expect(frame, `в показе снова выдуманное блюдо «${invented}»`).not.toContainText(
        invented,
      )
    }
  })

  test('показ берёт настоящие позиции отеля', async ({ page, request }) => {
    const titles = await realTitles(request)
    expect(titles.length, 'у отеля нет позиций — проверять нечего').toBeGreaterThan(1)

    await openBrand(page)
    const frame = page.getByTestId('brand-preview')

    // Хотя бы одно настоящее название обязано быть на экране. Именно «хотя бы»:
    // показ берёт две первые позиции, а порядок каталога — дело отеля.
    const shown = await frame.textContent()
    const hit = titles.some((title) => shown?.includes(title))
    expect(hit, `ни одного названия отеля в показе; было: ${titles.slice(0, 5).join(', ')}`).toBe(
      true,
    )
  })

  test('образец назван образцом, а не подсунут молча', async ({ page }) => {
    await openBrand(page)
    const frame = page.getByTestId('brand-preview')

    /*
      СТЕНД НАПОЛНЕН, поэтому здесь проверяется ОБРАТНОЕ: пометки «Образец» на
      экране нет, потому что и образца нет. Пара к ней — проверка выше, которая
      требует настоящих названий, и проверка ниже, которая требует пометки на
      пустом каталоге. Порознь любая из трёх зеленела бы не на том.
    */
    await expect(frame.getByTestId('brand-preview-sample-rows')).toHaveCount(0)
    await expect(frame.getByTestId('brand-preview-sample-detail')).toHaveCount(0)
  })

  test('каталога нет — показ говорит «образец», а не подсовывает молча', async ({ page }) => {
    /*
      ПУСТОЙ КАТАЛОГ ПОДАЁТСЯ ПЕРЕХВАТОМ ОТВЕТА, А НЕ ПУСТЫМ ОТЕЛЕМ.

      Отель у собранного фронта задан переменной сборки (`VITE_HOTEL_SUBDOMAIN`)
      — завести на стенде пустой и открыть его в этом же браузере нельзя. Зато
      ветка решается ровно одним ответом сервера, и подменив ЕГО, мы проверяем
      настоящий экран с настоящей отрисовкой: меняются только данные.
    */
    await page.route('**/cms/items*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    )

    await openBrand(page)
    const frame = page.getByTestId('brand-preview')

    await expect(
      frame.getByTestId('brand-preview-sample-rows'),
      'каталог пуст, а показ не сказал, что это образец',
    ).toBeVisible({ timeout: 15_000 })
    await expect(frame.getByTestId('brand-preview-sample-detail')).toBeVisible()

    // И по-прежнему ни одной выдумки: образец — это подписанный образец, а не
    // возвращённые «Ribeye Steak» под другим именем.
    for (const invented of ['Ribeye Steak', 'Caesar Salad', 'Vanilla Pavlova']) {
      await expect(frame).not.toContainText(invented)
    }
  })
})

test.describe('Показ бренда: шапка', () => {
  test('шапка в показе — тот же код, что у гостя', async ({ page }) => {
    await openBrand(page)

    // Телефон: у гостя шапки нет вовсе, и показ говорит об этом словами,
    // вместо того чтобы рисовать несуществующую полосу.
    await expect(page.getByTestId('brand-preview-no-header')).toBeVisible()
    await expect(page.getByTestId('guest-topbar')).toHaveCount(0)

    // Планшет: у гостя появляется настоящая верхняя строка — та же самая.
    await page.getByTestId('brand-preview-device-tablet').click()
    const bar = page.getByTestId('guest-topbar')
    await expect(bar, 'в показе нет настоящей шапки гостя').toBeVisible({ timeout: 10_000 })

    /*
      ВЫСОТА СВЕРЯЕТСЯ ЧИСЛОМ. Прежняя шапка показа была 56 пикселей против 62
      у гостя, и заметить это на глаз было нельзя — именно поэтому проверка
      меряет, а не смотрит.
    */
    const height = await bar.evaluate((node) => Math.round(node.getBoundingClientRect().height))
    expect(height, 'высота шапки в показе разошлась с гостевой').toBe(62)
  })
})
