import { expect, test, type Page } from '@playwright/test'

import { ADMIN, CREDENTIALS, DEMO_ROOM, login, loginToTracker } from './helpers'

/**
 * Сторож невлезающего текста.
 *
 * Ловит ДВА разных дефекта, которые гость видит одинаково — «текст обрезан», —
 * но чинятся они по-разному, и путать их нельзя:
 *
 *  1. ОБРЕЗКА — контент не помещается в свой контейнер, и контейнер его режет
 *     (`overflow: hidden`, `line-clamp`). Чинится высотой по контенту и
 *     переносом строк.
 *
 *  2. ПЕРЕКРЫТИЕ — текст на месте и нужного размера, но поверх него лежит
 *     сосед. Ровно так пропадало уведомление «просмотр без номера»: панель
 *     каталога подтянута вверх на `panelOverlap` и накрывала нижнюю половину
 *     строки. Метрики элемента при этом ИДЕАЛЬНЫ — scrollHeight равен
 *     clientHeight, — поэтому проверка на обрезку такой дефект не видит.
 *     Это и есть причина, по которой сторож проверяет обе вещи.
 *
 * Дефект геометрический, а не цветовой, поэтому обе темы: он воспроизводился
 * и в тёмной, и в светлой, и «починили в светлой» ничего не значило.
 */

const THEME_KEY = 'itv.theme-mode'

const VIEWPORTS = [
  { name: 'телефон', width: 390, height: 844 },
  { name: 'планшет', width: 834, height: 1112 },
  { name: 'десктоп', width: 1440, height: 900 },
]

/** Плашки и чипы: то, что несёт короткий важный текст в своей рамке. */
const BANNER_SELECTOR = '.MuiAlert-root, .MuiChip-root, [data-testid*="notice"], [data-testid*="banner"]'

interface Clipped {
  where: string
  text: string
  client: number
  scroll: number
}

/** Контент не влез И контейнер его режет. Скроллящиеся списки не в счёт. */
async function clippedTexts(page: Page): Promise<Clipped[]> {
  return page.evaluate((selector) => {
    const out: Clipped[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 4 || rect.height < 4) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue

      const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip'
      const overY = el.scrollHeight - el.clientHeight > 1
      const overX = el.scrollWidth - el.clientWidth > 1

      if ((overY && clipsY) || (overX && clipsX)) {
        const tid = el.getAttribute('data-testid')
        out.push({
          where: `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ''}`,
          text: (el.textContent ?? '').trim().slice(0, 60),
          client: overY ? el.clientHeight : el.clientWidth,
          scroll: overY ? el.scrollHeight : el.scrollWidth,
        })
      }
    }
    return out
  }, BANNER_SELECTOR)
}

/**
 * Плашка не должна быть накрыта соседом.
 *
 * Пробуем пять точек вдоль строки: перекрытие обычно частичное (уголок,
 * половина строки), и одной центральной точки для него мало.
 */
async function coverage(page: Page, testId: string): Promise<{ covered: number; by: string | null }> {
  return page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    if (!el) return { covered: 0, by: null }
    const r = el.getBoundingClientRect()
    let covered = 0
    let by: string | null = null
    // По вертикали обязательно берём пробу У САМОГО НИЗА: нахлёст соседа
    // съедает нижнюю полосу, и на телефоне, где плашка втрое выше, точки на
    // 0.3/0.7 проходят ВЫШЕ накрытой зоны — дефект есть, а сторож молчит.
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const fy of [0.25, 0.5, 0.75, 0.94]) {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue
        const top = document.elementFromPoint(x, y)
        if (!top || top === el || el.contains(top) || top.contains(el)) continue
        covered += 1
        by = `${top.tagName.toLowerCase()}.${(top.className || '').toString().split(/\s+/)[0] ?? ''}`
      }
    }
    return { covered, by }
  }, testId)
}

async function enterViewOnly(page: Page, mode: 'dark' | 'light') {
  await page.goto('/')
  await page.evaluate(
    ([key, value]) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem(key, value)
    },
    [THEME_KEY, mode],
  )
  await page.goto('/')
  await page.getByTestId('guest-browse-only').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
}

async function enterWithRoom(page: Page, mode: 'dark' | 'light') {
  await page.goto('/')
  await page.evaluate(
    ([key, value]) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem(key, value)
    },
    [THEME_KEY, mode],
  )
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
}

// `/room` — управление номером (G5). Экран плиточный и с липкой шапкой,
// то есть ровно тот класс, к которому предрасположены и обрезка подписи,
// и перекрытие соседом.
const GUEST_ROUTES = ['/home', '/venue/kitchen', '/info', '/cart', '/orders', '/room']

for (const mode of ['dark', 'light'] as const) {
  for (const vp of VIEWPORTS) {
    test(`плашки вмещают текст: ${mode}, ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await enterViewOnly(page, mode)

      for (const route of GUEST_ROUTES) {
        await page.goto(route)
        await page.waitForTimeout(1200)
        const clipped = await clippedTexts(page)
        expect(clipped, `${route} (${mode}/${vp.name}): текст обрезан`).toEqual([])
      }
    })

    test(`уведомление «просмотр без номера» видно целиком: ${mode}, ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await enterViewOnly(page, mode)
      await page.goto('/venue/kitchen')

      const notice = page.getByTestId('guest-view-only-notice')
      await expect(notice).toBeVisible({ timeout: 15_000 })

      // 1. Текст помещается в плашку.
      const box = await notice.evaluate((el) => ({
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        text: (el.textContent ?? '').trim(),
      }))
      expect(box.text.length, 'уведомление без текста').toBeGreaterThan(10)
      expect(
        box.scrollH - box.clientH,
        `${mode}/${vp.name}: текст не влезает в плашку (${box.clientH} < ${box.scrollH})`,
      ).toBeLessThanOrEqual(1)

      // 2. И плашку никто не накрывает — именно так она пропадала.
      const { covered, by } = await coverage(page, 'guest-view-only-notice')
      expect(covered, `${mode}/${vp.name}: плашку перекрывает ${by}`).toBe(0)
    })

    test(`плашки вмещают текст в номере: ${mode}, ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await enterWithRoom(page, mode)

      for (const route of GUEST_ROUTES) {
        await page.goto(route)
        await page.waitForTimeout(1200)
        const clipped = await clippedTexts(page)
        expect(clipped, `${route} (${mode}/${vp.name}): текст обрезан`).toEqual([])
      }
    })
  }
}

/**
 * Плавающая группа не накрывает план — НА РАЗНЫХ ПОЗИЦИЯХ СКРОЛЛА.
 *
 * Прошлая проверка смотрела только начало страницы и потому пропустила дефект:
 * группа стоит с учётом безопасной зоны устройства, а липкие полосы пинились
 * числом, и на телефоне с вырезом группа съезжала вниз и ложилась на плиту.
 * Статическая проверка этого не видит — перекрытие появляется в движении.
 */
for (const mode of ['dark', 'light'] as const) {
  for (const vp of VIEWPORTS.filter((v) => v.width < 1024)) {
    test(`плавающая группа не закрывает план: ${mode}, ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await enterWithRoom(page, mode)
      await page.goto('/room')
      await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(1500)

      for (const y of [0, 40, 90, 140, 200, 320, 500]) {
        await page.evaluate((to) => window.scrollTo(0, to), y)
        await page.waitForTimeout(180)
        const probe = await page.evaluate(() => {
          const chip = document.querySelector('[data-testid="guest-room-chip"]')
          const plate = document.querySelector('[data-testid="room-plan"]')
          if (!chip || !plate) return null
          // Плавающая группа — стеклянная полоса, в которой лежит чип номера.
          const group = chip.closest('.MuiStack-root') ?? chip
          const a = group.getBoundingClientRect()
          const b = plate.getBoundingClientRect()
          const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          return { overlap: Math.round(Math.min(dx, dy)), scroll: Math.round(window.scrollY) }
        })
        expect(probe, 'плита или чип не найдены').not.toBeNull()
        expect(
          probe!.overlap,
          `${mode}/${vp.name}: на скролле ${probe!.scroll} группа накрывает план на ${probe!.overlap}px`,
        ).toBeLessThanOrEqual(0)
      }
    })
  }
}

/*
 * Поверхности персонала. Тема здесь ОТЕЛЬНАЯ (демо-отель тёмный), поэтому
 * режим переключаем тем же ключом: у CMS и трекера ровно те же плашки и чипы,
 * и ломаются они так же.
 */

const CMS_ROUTES = [
  '/cms/dashboard',
  '/cms/services',
  '/cms/rooms',
  '/cms/staff',
  '/cms/brand',
  '/cms/analytics',
  '/cms/settings',
  '/cms/notifications',
  '/cms/marketing',
]

for (const mode of ['dark', 'light'] as const) {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test(`CMS: плашки вмещают текст: ${mode}, ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/')
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [THEME_KEY, mode],
      )
      await login(page, ADMIN)

      for (const route of CMS_ROUTES) {
        await page.goto(route)
        await page.waitForTimeout(1200)
        const clipped = await clippedTexts(page)
        expect(clipped, `${route} (${mode}/${vp.name}): текст обрезан`).toEqual([])
      }
    })

    test(`платформа и вход: плашки вмещают текст: ${mode}, ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })

      // Экран входа гостя — единственный, который гость видит ДО сессии.
      await page.goto('/')
      await page.evaluate(
        ([key, value]) => {
          localStorage.clear()
          sessionStorage.clear()
          localStorage.setItem(key, value)
        },
        [THEME_KEY, mode],
      )
      await page.goto('/')
      await expect(page.getByTestId('guest-room-submit')).toBeVisible({ timeout: 15_000 })
      expect(await clippedTexts(page), `вход гостя (${mode}/${vp.name})`).toEqual([])

      // Экран входа персонала.
      await page.goto('/login')
      await page.waitForTimeout(800)
      expect(await clippedTexts(page), `/login (${mode}/${vp.name})`).toEqual([])

      // Платформенная консоль: сводка и флот — экраны с плотными счётчиками,
      // где чипы и плашки обрезаются в первую очередь.
      await page.goto('/admin')
      await page.getByTestId('admin-login-email').fill('platform@itv.local')
      await page.getByTestId('admin-login-password').fill('platform12345')
      await page.getByTestId('admin-login-submit').click()
      await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(1200)
      expect(await clippedTexts(page), `/admin сводка (${mode}/${vp.name})`).toEqual([])

      // Флот — только там, где до него есть навигация. Консоль платформы
      // десктопная, и на узком экране боковое меню свёрнуто: гоняться за ним
      // здесь значило бы проверять не переполнение текста, а вёрстку меню.
      const fleetNav = page.getByTestId('admin-nav-fleet')
      if (await fleetNav.isVisible().catch(() => false)) {
        await fleetNav.click()
        await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 20_000 })
        await page.waitForTimeout(1200)
        expect(await clippedTexts(page), `/admin флот (${mode}/${vp.name})`).toEqual([])
      }
    })

    test(`трекер: плашки вмещают текст: ${mode}, ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/')
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [THEME_KEY, mode],
      )
      await loginToTracker(page, CREDENTIALS)
      await page.waitForTimeout(1200)

      const clipped = await clippedTexts(page)
      expect(clipped, `/tracker (${mode}/${vp.name}): текст обрезан`).toEqual([])
    })
  }
}
