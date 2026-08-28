import { expect, test, type Page } from '@playwright/test'

import { apiToken, ADMIN, guestTheme, HOTEL } from './helpers'

/**
 * Бренд-настройки с живым превью.
 *
 * Definition of Done: сменил тему/пресет в CMS → сохранил → гостевая
 * витрина отражает изменение. Проверяем именно доезд до гостя, а не только
 * перекраску превью: редактор бренда бесполезен, если витрина его не видит.
 */

async function openBrand(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })
}

test.describe('Бренд-настройки', () => {
  /**
   * Тесты правят общую тему демо-отеля, поэтому её нужно ВЕРНУТЬ — именно ту,
   * что была, а не «какую-нибудь».
   *
   * Раньше здесь применялся пресет `evening_concierge`. Это не восстановление,
   * а подмена: каждый прогон оставлял отель на чужом виде — другая палитра,
   * другая заголовочная гарнитура.
   *
   * Теперь снимаем СНИМОК настоящих токенов до теста и кладём его обратно
   * целиком через PUT: PATCH тут не годится, он deep-merge и не умеет убрать
   * ключ, появившийся во время теста (загруженную подложку, например).
   */
  let snapshot: unknown = null

  test.beforeEach(async ({ request }) => {
    const token = await apiToken(request)
    const resp = await request.get('http://localhost:8010/api/cms/brand', {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(resp.ok(), await resp.text()).toBeTruthy()
    snapshot = (await resp.json()).tokens
  })

  test.afterEach(async ({ request }) => {
    if (!snapshot) return
    const token = await apiToken(request)
    const restored = await request.put('http://localhost:8010/api/cms/brand', {
      data: { tokens: snapshot },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(restored.ok(), `бренд не восстановлен: ${await restored.text()}`).toBeTruthy()
  })

  test('сменил пресет → сохранил → витрина отражает', async ({ page, request }) => {
    await openBrand(page)

    // Живое превью — реальные компоненты, не картинка.
    await expect(page.getByTestId('brand-preview')).toBeVisible()

    // Применяем пресет — превью должно перекраситься до сохранения.
    await page.getByTestId('brand-preset-azure_light').click()
    await expect(page.getByTestId('brand-dirty')).toBeVisible()

    await page.getByTestId('brand-save').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden({ timeout: 15_000 })

    // Гость видит сохранённый пресет.
    await expect
      .poll(async () => (await guestTheme(request)).preset)
      .toBe('azure_light')
  })

  test('правка акцента доезжает до гостя как custom', async ({ page, request }) => {
    await openBrand(page)

    const accent = page.getByTestId('brand-accent')
    await expect(accent).toBeVisible()
    // Пикер — input type=color; задаём значение и триггерим change.
    await accent.evaluate((el: HTMLInputElement) => {
      el.value = '#ff5722'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.getByTestId('brand-dirty')).toBeVisible()

    await page.getByTestId('brand-save').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden({ timeout: 15_000 })

    const theme = await guestTheme(request)
    // Ручная правка снимает ярлык пресета.
    expect(theme.preset).toBe('custom')
    expect(theme.palette.light.secondary.toLowerCase()).toBe('#ff5722')
  })

  test('превью показывает светлую/тёмную и RTL, не трогая CMS', async ({ page }) => {
    await openBrand(page)

    const preview = page.getByTestId('brand-preview')
    await expect(preview).toBeVisible()

    // Переключатели меняют только превью — сама CMS остаётся LTR и в своём режиме.
    await page.getByTestId('brand-preview-mode-toggle').click()
    await page.getByTestId('brand-preview-rtl-toggle').click()

    // Превью получило rtl-направление, а страница CMS — нет.
    await expect(preview.locator('[dir="rtl"]').first()).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl')
  })

  test('сброс возвращает к сохранённому', async ({ page }) => {
    await openBrand(page)

    await page.getByTestId('brand-preset-marble_linen').click()
    await expect(page.getByTestId('brand-dirty')).toBeVisible()

    await page.getByTestId('brand-reset').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden()
  })

  /* ── Пункт 70: что за что отвечает ──────────────────────────────────── */

  test('каждый раздел подписан тем, где это увидит гость', async ({ page }) => {
    await openBrand(page)

    // Самая дорогая подпись из всех: отдельного поля «обложка» НЕТ, ею
    // становится фон вида «изображение». Без этой строки оператор ищет
    // обложку и не находит.
    const editor = page.getByTestId('brand-editor')
    await expect(editor).toContainText('Шапка приложения')
    await expect(editor).toContainText('ОБЛОЖКА первого экрана')
    await expect(editor).toContainText('Кнопки, ссылки и акценты')
  })

  test('порядок разделов — от того, что гость видит первым', async ({ page }) => {
    await openBrand(page)

    // Пресеты выше всех не как гостевая поверхность, а как точка входа: они
    // заменяют ручные правки, значит выбирать их надо ДО них.
    const order = ['brand-preset-warning', 'brand-logo-light-upload', 'brand-bg-kind', 'brand-font-body']
    const tops: number[] = []
    for (const id of order) {
      const box = await page.getByTestId(id).first().boundingBox()
      expect(box, `${id} не найден на экране`).toBeTruthy()
      tops.push(box!.y)
    }
    for (let i = 1; i < tops.length; i += 1) {
      expect(tops[i], `${order[i]} оказался выше ${order[i - 1]}`).toBeGreaterThan(tops[i - 1])
    }
  })

  test('пресет предупреждает, что заменит логотип и фон', async ({ page }) => {
    await openBrand(page)

    const warning = page.getByTestId('brand-preset-warning')
    await expect(warning).toBeVisible()
    // Подпись перечисляет, ЧТО меняется, и обещает, что логотипы и картинка
    // фона сохранятся. Раньше она предупреждала о пропаже логотипа — теперь
    // это было бы неправдой.
    await expect(warning).toContainText('логотипы и картинка фона сохраняются')
    await expect(warning).toContainText('Сбросить')
    await expect(warning).not.toContainText('включая загруженный логотип')
  })

  test('показ рисует первый экран гостя, а не абстрактные плитки', async ({ page }) => {
    await openBrand(page)

    // Парадная — единственное место, где виден результат выбора «фон →
    // изображение». Раньше показ начинался с меню, и обложку было не увидеть.
    const preview = page.getByTestId('brand-preview')
    await expect(preview.getByTestId('guest-home-hero')).toBeVisible({ timeout: 15_000 })
  })

  test('пресет не стирает логотипы и картинку фона отеля', async ({ page, request }) => {
    /*
      УКУС. Пресет — это готовый ВИД; логотип и фотография отеля видом не
      являются, их загрузил отель.

      Раньше `applyPreset` заменял черновик целиком, а логотипы в пресетах
      пустые — один клик убирал и логотип, и картинку. Молча.

      Проверяем КОНЕЧНОЕ состояние (после сохранения), а не черновик: черновик
      мог бы выглядеть верно и не доехать до сервера.
    */
    const token = await apiToken(request)
    const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
    const api = 'http://localhost:8010/api/cms/brand'

    const before = (await (await request.get(api, { headers })).json()).tokens
    const cover = before?.brand?.background?.imageUrl
    expect(cover, 'у демо-отеля нет картинки фона — укусу не на чем работать').toBeTruthy()

    // Логотипы отелю дописываем: в сиде они пустые, а терять нам надо именно их.
    const seeded = await request.patch(api, {
      headers,
      data: { tokens: { brand: { logoLight: cover, logoDark: cover } } },
    })
    expect(seeded.ok(), await seeded.text()).toBeTruthy()

    // Пресет берём ОТЛИЧНЫЙ от текущего: демо-отель уже сидит на
    // `midnight_navy`, и на нём «цвета сменились» проверить нечем — первая
    // версия укуса поймала ровно это.
    const target = before.preset === 'marble_linen' ? 'sapphire_dark' : 'marble_linen'

    await openBrand(page)
    await page.getByTestId(`brand-preset-${target}`).click()
    await page.getByTestId('brand-save').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden({ timeout: 15_000 })

    const after = (await (await request.get(api, { headers })).json()).tokens

    // 1. Своё — на месте.
    expect(after.brand.logoLight, 'пресет стёр светлый логотип').toBeTruthy()
    expect(after.brand.logoDark, 'пресет стёр тёмный логотип').toBeTruthy()
    expect(
      after.brand.background.imageAssetId ?? after.brand.background.imageUrl,
      'пресет потерял картинку фона — вернуть её без повторной загрузки нельзя',
    ).toBeTruthy()

    // 2. Вид фона — от пресета: иначе пресет читался бы как несработавший.
    //
    // Сверяем с САМИМ пресетом, а не с зашитым «градиентом»: у разных пресетов
    // вид разный (`marble_linen` несёт абстракцию), и зашитое значение делало
    // укус проверкой моей памяти, а не поведения.
    const presets = (await (await request.get('http://localhost:8010/api/cms/brand/presets', { headers })).json()).presets
    const chosen = presets.find((item: { code: string }) => item.code === target)
    expect(chosen, `пресет ${target} пропал из библиотеки`).toBeTruthy()
    expect(after.brand.background.kind).toBe(chosen.tokens.brand.background.kind)
    expect(after.brand.background.kind).not.toBe('image')

    // 3. Вид при этом действительно сменился, а не «сохранили всё подряд».
    expect(after.preset).toBe(target)
    expect(JSON.stringify(after.palette)).not.toBe(JSON.stringify(before.palette))
    expect(JSON.stringify(after.typography)).not.toBe(JSON.stringify(before.typography))
  })

  test('спрятанная картинка фона объявлена, а не потеряна', async ({ page }) => {
    await openBrand(page)
    await page.getByTestId('brand-preset-midnight_navy').click()

    // Вид стал градиентом, картинка лежит невидимая — экран обязан сказать,
    // что она цела, иначе оператор грузит файл заново.
    await expect(page.getByTestId('brand-bg-image-kept')).toBeVisible()
  })
})
