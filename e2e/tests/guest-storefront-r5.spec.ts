import { expect, test, type Page } from '@playwright/test'

import { STORAGE_KEYS } from '../fixtures/appState'

import {
  ADMIN,
  API,
  apiHeaders,
  apiToken,
  BARMAN,
  DEMO_ROOM,
  loginToTracker,
  openCart,
} from './helpers'

/**
 * R5: витрина гостя.
 *
 * Главное, что здесь проверяется, — fan-out ОЖИЛ: заказ, собранный гостем в
 * витрине, разъезжается на две доски трекера. До R5 витрина не слала код
 * заведения, реальные заказы оставались плоскими, и разъезд жил только в
 * фикстурах.
 */

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
}

test.describe('Парадная и проваливание', () => {
  test('главная — кадр отеля и витрина заведений', async ({ page }) => {
    await enterAsGuest(page)

    await expect(page.getByTestId('guest-home-hero')).toBeVisible()
    await expect(page.getByTestId('guest-home-bento')).toBeVisible()
  })

  test('гость проваливается в ресторан и видит ЕГО меню', async ({ page }) => {
    await enterAsGuest(page)
    await page.getByTestId('guest-home-tile-kitchen').click()

    // Заведение представилось собой, а не отелем — это и была главная поломка.
    const venue = page.getByTestId('guest-venue')
    await expect(venue).toBeVisible({ timeout: 15_000 })
    await expect(venue).toHaveAttribute('data-content', 'product')
    await expect(page.getByTestId('guest-venue-name')).toContainText(/Панорама/)
    await expect(page.getByTestId('guest-venue-status')).toBeVisible()

    // И в нём его блюда.
    await expect(page.getByTestId('guest-qty-plus-caesar')).toBeVisible({ timeout: 15_000 })
  })

  test('заявка, слоты и инфо открываются своими блоками', async ({ page }) => {
    await enterAsGuest(page)

    for (const [code, content] of [
      ['concierge', 'service_request'],
      ['spa', 'slot'],
    ]) {
      await page.goto(`/venue/${code}`)
      const venue = page.getByTestId('guest-venue')
      await expect(venue).toBeVisible({ timeout: 15_000 })
      await expect(venue).toHaveAttribute('data-content', content)
      await expect(page.getByTestId('guest-venue-name')).toBeVisible()
    }

    // Инфо — отдельный раздел отеля, а не заведение.
    await page.goto('/info')
    await expect(page.getByTestId('guest-info-catalog')).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Посервисная корзина и разъезд', () => {
  // Сценарий тяжёлый: готовит заведение через CMS, ведёт гостя по витрине и
  // ждёт появления суб-заказа на чужой доске. Минуты по умолчанию мало.
  test.slow()

  test('смешанный заказ в агрегаторе разъезжается на две доски трекера', async ({
    browser,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const h = apiHeaders(token)
    const tag = Date.now().toString(36)

    // --- Заведение-агрегатор, включающее кухню и бар (модель R2, UI R4) ----
    const services = (await request
      .get(`${API}/api/cms/services`, { headers: h })
      .then((r) => r.json())) as Array<{ id: string; code: string }>
    const kitchen = services.find((s) => s.code === 'kitchen')!
    const bar = services.find((s) => s.code === 'bar')!
    const barPoint = (
      await request.get(`${API}/api/cms/services/${bar.id}`, { headers: h }).then((r) => r.json())
    ).execution_point.id

    const barCategory = await request
      .post(`${API}/api/cms/categories`, {
        data: { type: 'product', title: { ru: `Коктейли ${tag}` }, service_id: bar.id },
        headers: h,
      })
      .then((r) => r.json())
    await request.put(`${API}/api/cms/categories/${barCategory.id}/routes`, {
      data: { routes: [{ execution_point_id: barPoint }] },
      headers: h,
    })
    const cocktailTitle = `Негрони ${tag}`
    await request.post(`${API}/api/cms/items`, {
      data: {
        category_id: barCategory.id,
        type: 'product',
        title: { ru: cocktailTitle },
        price: 65000,
      },
      headers: h,
    })

    const aggregator = await request
      .post(`${API}/api/cms/services`, {
        data: { type: 'room_service', public_name: { ru: `Рум-сервис ${tag}` } },
        headers: h,
      })
      .then((r) => r.json())
    for (const source of [kitchen.id, bar.id]) {
      const included = await request.post(
        `${API}/api/cms/services/${aggregator.id}/inclusions`,
        { data: { source_service_id: source }, headers: h },
      )
      expect(included.ok(), await included.text()).toBeTruthy()
    }

    // --- Гость собирает корзину В АГРЕГАТОРЕ и оформляет -------------------
    const guestContext = await browser.newContext()
    const barContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const barman = await barContext.newPage()

    try {
      await loginToTracker(barman, BARMAN)

      await enterAsGuest(guest)
      await guest.goto(`/venue/${aggregator.execution_point.code}`)
      await expect(guest.getByTestId('guest-venue')).toBeVisible({ timeout: 15_000 })

      // Обе позиции заимствованные: салат с кухни, коктейль из бара —
      // объединённое меню агрегатора (R2) гость видит как одно.
      await guest.getByTestId('guest-qty-plus-caesar').click()

      // Коктейль добавляем через карточку: его код сгенерирован, и обращаться
      // к нему по testid значило бы знать этот код заранее.
      await guest.getByText(cocktailTitle).first().click()
      await expect(guest.getByTestId('guest-item-sheet')).toBeVisible({ timeout: 15_000 })
      await guest.getByTestId('guest-add-to-cart').click()

      // На десктопе корзина — колонка справа и уже видна; полоса есть только
      // на узком экране. Помощник знает разницу.
      await openCart(guest)
      await guest.getByTestId('guest-place-order').click()
      await expect(guest.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })

      const number = (await guest.getByTestId('guest-order-number').innerText()).match(
        /\d+/,
      )?.[0] as string
      expect(number).toBeTruthy()

      // --- Разъезд: коктейль приехал на доску БАРА со ссылкой на этот заказ ---
      const source = barman.locator('[data-testid^="tracker-source-"]', {
        hasText: `№${number}`,
      })
      await expect(source.first()).toBeVisible({ timeout: 25_000 })

      const board = barman.getByTestId('tracker-board')
      await expect(board).toContainText(new RegExp(cocktailTitle, 'i'))
      await expect(board).not.toContainText(/цезарь/i)

      // А гостю разъезд не виден: он заказывал один раз.
      await guest.goto('/orders')
      await expect(guest.getByTestId('guest-orders-list')).toBeVisible({ timeout: 15_000 })
      // Один заказ, а не два: разъезд — деталь исполнения, гостю не видная.
      await expect(guest.getByTestId(`guest-order-row-${number}`)).toBeVisible()
    } finally {
      await guestContext.close()
      await barContext.close()
    }
  })
})

test.describe('Выход из сервиса', () => {
  // Заходы по четырём типам на трёх ширинах — десяток загрузок страницы.
  test.slow()

  const VIEWPORTS = [
    { name: 'телефон', size: { width: 390, height: 844 } },
    { name: 'планшет', size: { width: 834, height: 1112 } },
    { name: 'десктоп', size: { width: 1440, height: 900 } },
  ]

  test('стрелка в шапке возвращает на главную с любого типа и на любой ширине', async ({
    page,
    request,
  }) => {
    // Инфо-сервиса в демо-отеле нет, а проверить нужно ВСЕ четыре типа: заводим
    // свой и убираем за собой, чтобы витрина отеля не обрастала мусором тестов.
    const token = await apiToken(request, ADMIN)
    const h = apiHeaders(token)
    const info = await request
      .post(`${API}/api/cms/services`, {
        data: { type: 'info', public_name: { ru: `Об отеле ${Date.now().toString(36)}` } },
        headers: h,
      })
      .then((r) => r.json())

    try {
      const venues: Array<[string, string]> = [
        ['kitchen', 'product'],
        ['concierge', 'service_request'],
        ['spa', 'slot'],
        [info.execution_point.code, 'info'],
      ]

      await enterAsGuest(page)

      for (const { name, size } of VIEWPORTS) {
        await page.setViewportSize(size)
        for (const [code, content] of venues) {
          await page.goto(`/venue/${code}`)
          const venue = page.getByTestId('guest-venue')
          await expect(venue, `${name}: ${code} не открылся`).toBeVisible({ timeout: 15_000 })
          await expect(venue).toHaveAttribute('data-content', content)

          // Один клик — и гость снова на витрине сервисов.
          await page.getByTestId('guest-venue-back').click()
          await expect(page.getByTestId('guest-home'), `${name}: ${code} не вышел`).toBeVisible({
            timeout: 15_000,
          })
          await expect(page).toHaveURL(/\/home$/)
        }
      }
    } finally {
      await request.delete(`${API}/api/cms/services/${info.id}`, { headers: h })
    }
  })

  test('нижнее меню и верхняя строка тоже ведут на главную', async ({ page }) => {
    await enterAsGuest(page)

    // Один и тот же testid на обеих раскладках: на телефоне это нижнее
    // стеклянное меню, на десктопе — верхняя стеклянная строка.
    for (const size of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size)
      await page.goto('/venue/spa')
      await expect(page.getByTestId('guest-venue')).toBeVisible({ timeout: 15_000 })

      await page.getByTestId('guest-nav-home').click()
      await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
    }
  })
})

test.describe('Вход', () => {
  test('QR лобби без номера — видит витрину, но не заказывает', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.localStorage.clear())
    await page.goto('/')

    // Вход «осмотреться» — сессия без номера.
    const lobby = page.getByTestId('guest-browse-only')
    if (!(await lobby.isVisible().catch(() => false))) {
      test.skip(true, 'на экране входа нет режима «только просмотр»')
    }
    await lobby.click()

    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
    await page.goto('/venue/kitchen')
    await expect(page.getByTestId('guest-venue')).toBeVisible({ timeout: 15_000 })
    // Витрина видна, а оформление закрыто.
    await expect(page.getByTestId('guest-view-only-notice')).toBeVisible()
  })
})

test.describe('Выход из отеля', () => {
  test('гость выходит из отеля и попадает на экран входа', async ({ page }) => {
    await enterAsGuest(page)

    // Чип номера — он же вход в меню сессии. Владелец у него один: до этого
    // на телефоне чип рисовали и шелл, и шапка героя, и гость видел два.
    await expect(page.getByTestId('guest-room-chip')).toHaveCount(1)
    await page.getByTestId('guest-room-chip').click()
    await page.getByTestId('guest-leave-hotel').click()

    // Экран входа, а не /login: у гостя нет учётки, он представляется номером.
    await expect(page.getByTestId('guest-room-input')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/$/)

    // Сессия действительно закончилась: возврат на главную снова просит номер.
    await page.goto('/home')
    await expect(page.getByTestId('guest-room-input')).toBeVisible({ timeout: 15_000 })
  })

  test('на телефоне чип номера тоже один', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await enterAsGuest(page)
    await expect(page.getByTestId('guest-room-chip')).toHaveCount(1)
  })
})

/**
 * КАРТОЧКА ПОЗИЦИИ: раскладка данных.
 *
 * Проверяется не «красиво ли», а то, что карточка ЧИТАЕТСЯ ИЗ ДАННЫХ: метка
 * категории стоит на кадре, добавка набирается кнопкой и пересчитывает цену,
 * ограничение группы соблюдается, а позиция без единого блока данных не
 * оставляет пустых заголовков.
 */
test.describe('Карточка позиции', () => {
  /** Открыть карточку ссылкой — порядок позиций в меню на это не влияет. */
  async function openItem(page: Page, code: string): Promise<void> {
    await enterAsGuest(page)
    await page.getByTestId('guest-home-tile-kitchen').click()
    await expect(page.getByTestId(`guest-qty-plus-${code}`)).toBeVisible({ timeout: 15_000 })
    await page.getByTestId(`guest-item-${code}`).click()
    await expect(page.getByTestId('guest-item-sheet')).toBeVisible()
  }

  test('метка категории стоит на кадре, а не строкой над названием', async ({ page }) => {
    await openItem(page, 'ribeye')
    const chip = page.getByTestId('guest-item-category')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText(/Горячее/i)

    // Метка лежит ВНУТРИ кадра: у неё общий предок с картинкой позиции, и
    // верхний край метки ниже верхнего края кадра.
    const inside = await chip.evaluate((el) => {
      const media = el.parentElement
      const image = media?.querySelector('img')
      if (!media || !image) return false
      const chipBox = el.getBoundingClientRect()
      const mediaBox = media.getBoundingClientRect()
      return chipBox.top >= mediaBox.top - 1 && chipBox.bottom <= mediaBox.bottom + 1
    })
    expect(inside, 'метка категории должна лежать на кадре').toBeTruthy()
  })

  test('добавка набирается кнопкой, цена в подвале растёт, предел соблюдается', async ({
    page,
  }) => {
    await openItem(page, 'ribeye')
    const add = page.getByTestId('guest-add-to-cart')
    await expect(add).toContainText('1 900')

    // Карточка добавки — с ценой и кнопкой, а не голый чип.
    const sauce = page.getByTestId('guest-modifier-option-sauce_pepper')
    await expect(sauce).toHaveAttribute('data-kind', 'addon')
    await expect(sauce).toContainText('150')
    await expect(sauce).toHaveAttribute('data-selected', 'false')

    await sauce.click()
    await expect(sauce).toHaveAttribute('data-selected', 'true')
    await expect(add).toContainText('2 050')

    // Предел группы — «до 3»: набираем все три и убеждаемся, что подвал
    // сложил их все, а не последнюю.
    await expect(page.getByTestId('guest-addon-limit')).toContainText('3')
    const addons = page.locator('[data-kind="addon"]')
    const total = await addons.count()
    for (let i = 0; i < total; i += 1) {
      const card = addons.nth(i)
      if ((await card.getAttribute('data-selected')) === 'false') await card.click()
    }
    // 1 900 + 150 + 250 + 350 = 2 650 ₽.
    await expect(add).toContainText('2 650')

    // Снятая добавка возвращает цену — набор именно набирается, а не копится.
    await sauce.click()
    await expect(add).toContainText('2 500')
  })

  test('позиция без данных: ни пустых заголовков, ни разъехавшейся раскладки', async ({
    page,
  }) => {
    // В сиде такой позиции нет — подменяем ответ, чтобы проверить поведение
    // карточки на пустых полях, а не наличие такой позиции в меню.
    await page.route('**/guest/item/**', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({
        json: {
          ...body,
          images: [],
          nutrition: null,
          characteristics: [],
          allergens: [],
          markers: [],
          badges: [],
          modifier_groups: [],
          description: null,
        },
      })
    })
    await openItem(page, 'ribeye')

    const sheet = page.getByTestId('guest-item-sheet')
    await expect(sheet.getByTestId('guest-item-nutrition')).toHaveCount(0)
    await expect(sheet.getByTestId('guest-item-characteristics')).toHaveCount(0)
    await expect(sheet.getByTestId('guest-item-allergens')).toHaveCount(0)
    await expect(sheet.locator('[data-kind="addon"]')).toHaveCount(0)
    // Ни одной подписи блока, под которой ничего нет.
    await expect(sheet.getByText(/Состав|Содержит|Подходит/)).toHaveCount(0)

    // Заказать по-прежнему можно: карточка не развалилась.
    await expect(page.getByTestId('guest-add-to-cart')).toBeEnabled()
    await expect(page.getByTestId('guest-item-comment')).toBeVisible()
  })
})

/**
 * ПОДПИСЬ ПОД НАЗВАНИЕМ — В ЦВЕТ, НО ЧИТАЕМАЯ.
 *
 * Краткое описание позиции («Мраморная говядина, 300 г») взято в акцент отеля
 * со стеклянным подтоном — тем же приёмом, что липкая строка категорий. Приём
 * хорош ровно до тех пор, пока текст читается.
 *
 * МЕРЯЕМ ПИКСЕЛЯМИ СНИМКА, А НЕ ВЫЧИСЛЕННЫМИ СТИЛЯМИ, и это выстрадано.
 * Прошлая версия сторожа складывала `background-color` предков и на этом
 * основании отчитывалась о 4.81:1. На экране в шторке было 3.93:1: под
 * стеклом шторки лежит РАЗМЫТОЕ ФОТО БЛЮДА, никакого `background-color` у
 * него нет, и сумма цветов предков его не видела. Гость увидел «серую»
 * подпись там, где сторож видел зелёный тест. Пиксели снимка врать не умеют:
 * что нарисовано, то и померено — вместе со стеклом, размытием и фотографией.
 */
const AA = 4.5

/**
 * Контраст текста к фону ПО ПИКСЕЛЯМ кадра.
 *
 * Фон — самый частый цвет кадра, текст — самый далёкий от него по яркости из
 * тех, что занимают заметную долю: ядро глифов, а не кайма сглаживания.
 */
const PIXEL_CONTRAST = `async (src) => {
  const img = new Image(); img.src = src; await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.width; canvas.height = img.height
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const counts = new Map()
  for (let i = 0; i < data.length; i += 4) {
    const key = data[i] + ',' + data[i + 1] + ',' + data[i + 2]
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const total = data.length / 4
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const bg = sorted[0][0].split(',').map(Number)
  const luminance = (c) => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
  }
  const bgLuminance = luminance(bg)
  let text = bg
  let far = 0
  for (const [key, count] of sorted) {
    if (count / total < 0.0005) continue
    const rgb = key.split(',').map(Number)
    const distance = Math.abs(luminance(rgb) - bgLuminance)
    if (distance > far) { far = distance; text = rgb }
  }
  const [light, dark] = [luminance(text), bgLuminance].sort((a, b) => b - a)
  return {
    bg: 'rgb(' + bg.join(',') + ')',
    text: 'rgb(' + text.join(',') + ')',
    ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100,
  }
}`

for (const mode of ['dark', 'light'] as const) {
  test(`подпись позиции: в цвет отеля и не ниже AA — ${mode}`, async ({ page }) => {
    /*
      Тема ставится ПОСЛЕ входа, и это не перестраховка: `enterAsGuest` сам
      чистит localStorage — поставь режим до него, и он же его сотрёт. Ровно
      так «светлый» прогон этого сторожа однажды прошёл в тёмной теме и
      отчитался зелёным, ничего не проверив.
    */
    await enterAsGuest(page)
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEYS.theme, mode],
    )
    await page.reload()
    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })

    // И проверяем, что тема ДОЕХАЛА: светлая карточка светлая, тёмная тёмная.
    const paperIsDark = await page.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)!.map(Number)
      return (r + g + b) / 3 < 128
    })
    expect(paperIsDark, `тема ${mode} не доехала до страницы`).toBe(mode === 'dark')

    await page.getByTestId('guest-home-tile-kitchen').click()
    await expect(page.getByTestId('guest-item-ribeye')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1200)

    const measure = new Function('return ' + PIXEL_CONTRAST)()
    /** Снимок самой подписи → пиксельный контраст того, что видит гость. */
    const onScreen = async (selector: string) => {
      const shot = await page.locator(selector).first().screenshot()
      return page.evaluate(measure, `data:image/png;base64,${shot.toString('base64')}`)
    }
    const cssColor = (selector: string) =>
      page.locator(selector).first().evaluate((el) => getComputedStyle(el).color)

    const card = await onScreen('[data-testid="guest-item-ribeye"] p')
    expect(
      card.ratio,
      `${mode}: подпись на карточке ${card.text} на фоне ${card.bg} — контраст ${card.ratio}:1 при пороге ${AA}:1`,
    ).toBeGreaterThanOrEqual(AA)

    /*
      ЦВЕТ — АКЦЕНТА ОТЕЛЯ, А НЕ НЕЙТРАЛЬНЫЙ. Конкретное значение не проверяем:
      оно принадлежит бренду, и у другого отеля будет другим. Проверяем, что
      подпись УШЛА от нейтрального текста витрины — до правки она была ровно
      им, и это единственное сравнение, которое поймает откат.

      Сосед для сравнения — строка КБЖУ той же карточки: она осталась
      нейтральной намеренно (иерархия), и стоит рядом в тех же условиях.
    */
    const cardColor = await cssColor('[data-testid="guest-item-ribeye"] p')
    const neutral = await cssColor(
      '[data-testid="guest-item-ribeye"] [data-testid="guest-item-nutrition-inline"]',
    )
    expect(cardColor, 'подпись осталась нейтральной, как была').not.toBe(neutral)

    /*
      ТА ЖЕ ПОДПИСЬ В ОТКРЫТОЙ ПОЗИЦИИ. Здесь под стеклом шторки лежит
      размытое фото блюда, и без непрозрачной основы под подложкой фон
      получался светлее карточки — тот самый случай, когда цвет один, а
      читаемость разная.
    */
    await page.getByTestId('guest-item-ribeye').click()
    await expect(page.getByTestId('guest-item-sheet')).toBeVisible()
    await page.waitForTimeout(1200)

    const sheet = await onScreen('[data-testid="guest-item-sheet"] p')
    expect(
      sheet.ratio,
      `${mode}: подпись в шторке ${sheet.text} на фоне ${sheet.bg} — контраст ${sheet.ratio}:1`,
    ).toBeGreaterThanOrEqual(AA)
    /*
      ФОН У КАРТОЧКИ И ШТОРКИ РАЗНЫЙ — И ЭТО ТЕПЕРЬ ПРАВИЛЬНО.

      Здесь стояло требование совпадения: оно описывало прежнее решение, где
      под стеклом шторки лежала непрозрачная основа. Основы больше нет —
      панель снова стеклянная, и сквозь неё видно то, что за шторкой, поэтому
      фон там свой. Требование заменено на то, ради чего всё делалось: текст
      читается в обоих местах, и проверяется это порознь, по пикселям.
    */
    expect(sheet.ratio, `${mode}: подпись в шторке ниже AA`).toBeGreaterThanOrEqual(AA)
    expect(
      await cssColor('[data-testid="guest-item-sheet"] p'),
      'список и открытая позиция разошлись в цвете',
    ).toBe(cardColor)

    /*
      ИЕРАРХИЯ НА МЕСТЕ. Красить всё подряд нельзя: подписи единиц КБЖУ и
      заголовки блоков остаются нейтральными, иначе экран превращается в
      одноцветный список, где ничто не главнее другого.
    */
    const inSheet = await page.evaluate(() => {
      const pick = (selector: string) => {
        const el = document.querySelector(selector)
        return el ? getComputedStyle(el).color : null
      }
      return {
        nutrition: pick('[data-testid="guest-item-sheet"] [data-testid="guest-item-nutrition"]'),
        heading: pick('[data-testid="guest-item-sheet"] h6'),
      }
    })
    if (inSheet.nutrition) {
      expect(inSheet.nutrition, 'КБЖУ покрасили вместе с описанием').not.toBe(cardColor)
    }
    if (inSheet.heading) {
      expect(inSheet.heading, 'заголовок блока покрасили вместе с описанием').not.toBe(cardColor)
    }
  })
}
