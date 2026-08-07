import { expect, test, type Page } from '@playwright/test'

import { DEMO_ROOM } from './helpers'

/**
 * СТОРОЖ ЛИПКИХ СЛОЁВ.
 *
 * Прежняя проверка смотрела одну пару элементов (плавающая группа и плита) на
 * семи позициях прокрутки одного экрана. Этого хватило ровно до следующего
 * слоя: перекрывались уже вкладки с плитой, потом строка категорий с чипом
 * номера, и каждый раз мы узнавали об этом от человека, а не от прогона.
 *
 * Здесь проверяется ПРАВИЛО, а не пара: ни один липкий слой не накрывает
 * содержимое под собой — на десяти позициях прокрутки, трёх ширинах, в обеих
 * темах и на всех гостевых маршрутах. Липкие слои ищутся по вычисленному
 * стилю, а не по списку: слой, добавленный завтра, попадёт под сторож сам.
 */

const VIEWPORTS = [
  { name: 'телефон', width: 390, height: 844 },
  { name: 'планшет', width: 834, height: 1112 },
  { name: 'десктоп', width: 1440, height: 900 },
]

const ROUTES = ['/home', '/venue/kitchen', '/orders', '/info', '/room']

/** Сколько пикселей перекрытия считаем шумом округления. */
const TOLERANCE = 2

async function enterRoom(page: Page, mode: 'dark' | 'light'): Promise<void> {
  await page.goto('/')
  await page.evaluate((m) => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('itv.theme-mode', m)
  }, mode)
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 25_000 })
}

/**
 * ЧТО ИМЕННО СЧИТАЕТСЯ ПЕРЕКРЫТИЕМ.
 *
 * Липкие слои не должны накрывать ДРУГ ДРУГА — никогда и ни на одной позиции
 * прокрутки. Именно это и ломалось трижды: чип номера на плите, вкладки под
 * плитой, строка категорий под чипом. Слои стоят друг под другом стеком, и
 * пересечение здесь означает ровно одно — стек посчитан неверно.
 *
 * Обычное содержимое, проезжающее ПОД плавающим слоем при прокрутке, дефектом
 * не является: слои стеклянные, и «под ними» означает «продолжается». Что
 * содержимое не застревает под ними НАСОВСЕМ, проверяется отдельно — в покое
 * (в начале страницы) и в самом низу.
 */
/**
 * Найти липкие слои ОДИН РАЗ на маршрут и запомнить их в странице.
 *
 * Перебирать все элементы с `getComputedStyle` на каждой позиции прокрутки
 * значит гонять сотни тысяч вызовов и превращать сторож в сорокаминутный
 * прогон. Узлы за прокрутку не меняются — меняются только их рамки.
 */
async function collectLayers(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sticky = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const style = getComputedStyle(el)
      if (style.position !== 'sticky' && style.position !== 'fixed') return false
      const rect = el.getBoundingClientRect()
      if (rect.height <= 0 || style.visibility === 'hidden' || style.opacity === '0') return false
      /*
        Слои, ПРИЖАТЫЕ К НИЗУ (нижнее меню, липкий подвал корзины), под это
        правило не подпадают: содержимое проходит под ними по устройству
        витрины — они стеклянные и полупрозрачные, и «пройти под» здесь
        означает «продолжается», а не «спрятано». Что под ними ничего не
        застревает НАСОВСЕМ, проверяет отдельный тест — в самом низу страницы.
      */
      return rect.top + rect.height / 2 < window.innerHeight / 2
    })
    ;(window as unknown as { __layers: HTMLElement[] }).__layers = sticky
    return sticky.length
  })
}

async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate((tolerance) => {
    const sticky = ((window as unknown as { __layers?: HTMLElement[] }).__layers ?? []).filter(
      (el) => el.isConnected && el.getBoundingClientRect().height > 0,
    )
    const name = (el: HTMLElement) =>
      el.dataset.testid ?? `${el.tagName.toLowerCase()}.${el.className.slice(0, 18)}`

    /*
      ВИДИМАЯ коробка слоя, а не зарезервированная. Считается по одному разу на
      слой: перебирать потомков внутри двойного цикла незачем.

      Плита сжимается трансформом внутри обёртки: место под неё остаётся
      прежним (иначе поедет высота документа), но ВИДНО меньше. Рамка обёртки
      этого не показывает — показывает рамка самого сжатого элемента. Сторож
      обязан смотреть на то же, что и гость.
    */
    const visibleRect = (el: HTMLElement): DOMRect => {
      const scaled = [...el.querySelectorAll<HTMLElement>('*')].find(
        (child) => getComputedStyle(child).transform !== 'none',
      )
      return (scaled ?? el).getBoundingClientRect()
    }

    const rects = sticky.map(visibleRect)
    const found: string[] = []
    for (let i = 0; i < sticky.length; i += 1) {
      for (let j = i + 1; j < sticky.length; j += 1) {
        const first = sticky[i]
        const second = sticky[j]
        // Вложенные слои — это один слой, а не два: у липкой обёртки внутри
        // может быть свой липкий потомок.
        if (first.contains(second) || second.contains(first)) continue
        const a = rects[i]
        const b = rects[j]
        const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        const overlap = Math.min(dx, dy)
        if (overlap > tolerance) {
          found.push(`«${name(first)}» и «${name(second)}» пересекаются на ${Math.round(overlap)}px`)
        }
      }
    }
    return [...new Set(found)]
  }, TOLERANCE)
}

/** В покое липкие слои не должны закрывать ни строки содержимого. */
async function coveredAtRest(page: Page): Promise<string[]> {
  return page.evaluate((tolerance) => {
    const sticky = [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (style.position !== 'sticky' && style.position !== 'fixed') return false
      if (rect.height <= 0 || style.visibility === 'hidden' || style.opacity === '0') return false
      return rect.top + rect.height / 2 < window.innerHeight / 2
    })
    const victims = [...document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, [role="tab"], [data-testid^="room-control-"], [data-testid^="room-pill-"]',
    )].filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.height > 6 && rect.bottom > 0 && rect.top < window.innerHeight
    })
    const found: string[] = []
    for (const layer of sticky) {
      const a = layer.getBoundingClientRect()
      for (const victim of victims) {
        if (layer.contains(victim) || victim.contains(layer)) continue
        if (sticky.some((other) => other !== layer && other.contains(victim))) continue
        const b = victim.getBoundingClientRect()
        const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (Math.min(dx, dy) > tolerance) {
          const hit = victim.dataset.testid ?? (victim.textContent ?? '').trim().slice(0, 24)
          found.push(`слой накрывает «${hit}»`)
        }
      }
    }
    return [...new Set(found)]
  }, TOLERANCE)
}

for (const mode of ['dark', 'light'] as const) {
  for (const vp of VIEWPORTS) {
    test(`липкие слои никого не накрывают: ${mode}, ${vp.name}`, async ({ page }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await enterRoom(page, mode)

      for (const route of ROUTES) {
        await page.goto(route)
        await page.waitForTimeout(1400)

        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        // ДЕСЯТЬ позиций вдоль страницы, а не одна: слои складываются
        // по-разному в начале прокрутки, в середине и у самого низа.
        const stops = Array.from({ length: 10 }, (_, index) =>
          Math.round((index / 9) * Math.max(0, height - vp.height)),
        )
        await collectLayers(page)
        // В покое экран обязан читаться целиком.
        expect(await coveredAtRest(page), `${mode}/${vp.name} ${route}: слой закрывает содержимое`).toEqual([])

        for (const y of stops) {
          await page.evaluate((to) => window.scrollTo(0, to), y)
          await page.waitForTimeout(140)
          const hits = await overlaps(page)
          expect(hits, `${mode}/${vp.name} ${route} на скролле ${y}`).toEqual([])
        }
      }
    })
  }
}

for (const vp of VIEWPORTS.filter((v) => v.width < 1024)) {
  test(`внизу страницы нижнее меню ничего не прячет: ${vp.name}`, async ({ page }) => {
    /*
      Обратная сторона того же правила: содержимое может проходить ПОД
      плавающим меню при прокрутке, но в конце страницы под ним не должно
      остаться ни одной кнопки и ни одной строки — иначе до них не добраться.
    */
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await enterRoom(page, 'dark')

    for (const route of ROUTES) {
      await page.goto(route)
      await page.waitForTimeout(1200)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(400)

      const hidden = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>('[data-testid="guest-nav-home"]')?.closest('.MuiPaper-root')
        if (!nav) return []
        const a = nav.getBoundingClientRect()
        return [...document.querySelectorAll<HTMLElement>('button, a, [role="tab"]')]
          .filter((el) => !nav.contains(el))
          .filter((el) => {
            const b = el.getBoundingClientRect()
            if (b.height < 6 || b.width < 6) return false
            const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            return Math.min(dx, dy) > 4
          })
          .map((el) => el.dataset.testid ?? (el.textContent ?? '').trim().slice(0, 24))
      })
      expect(hidden, `${route} (${vp.name}): под меню остались элементы`).toEqual([])
    }
  })
}

test('высота документа не меняется при сжатии плиты', async ({ page }) => {
  /*
    Требование из G5d, и оно остаётся: место под плиту зарезервировано, а
    сжимается только видимая картинка. Стоит высоте документа поехать — браузер
    начнёт поправлять позицию прокрутки, и экран затрясёт.
  */
  await page.setViewportSize({ width: 390, height: 844 })
  await enterRoom(page, 'dark')
  await page.goto('/room')
  await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1200)

  const heights: number[] = []
  for (const y of [0, 60, 120, 200, 320, 480, 700]) {
    await page.evaluate((to) => window.scrollTo(0, to), y)
    await page.waitForTimeout(200)
    heights.push(await page.evaluate(() => document.documentElement.scrollHeight))
  }
  expect(new Set(heights).size, `высота документа скакала: ${heights.join(' → ')}`).toBe(1)
})

test('вкладки идут под плитой на всём пути прокрутки', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterRoom(page, 'dark')
  await page.goto('/room')
  await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1200)

  for (const y of [0, 40, 90, 140, 200, 320, 500, 800]) {
    await page.evaluate((to) => window.scrollTo(0, to), y)
    await page.waitForTimeout(200)
    const gap = await page.evaluate(() => {
      const plate = document.querySelector('[data-testid="room-plan"]')?.getBoundingClientRect()
      const tabs = document.querySelector('[data-testid="room-tabs"]')?.getBoundingClientRect()
      if (!plate || !tabs) return null
      return Math.round(tabs.top - plate.bottom)
    })
    expect(gap, 'плита или вкладки не найдены').not.toBeNull()
    expect(gap!, `на скролле ${y} вкладки заехали под плиту (${gap}px)`).toBeGreaterThanOrEqual(0)
  }
})

/**
 * СТОРОЖ: вкладку ловит сама вкладка, а не то, что над ней.
 *
 * Найдено на живом телефоне: после небольшой прокрутки полоса вкладок видна и
 * на тапы не отвечает. Причина не в вкладках — плита сжимается трансформом, а
 * раскладку трансформ не меняет: её липкая обёртка остаётся прежней высоты и,
 * стоя выше по z, забирает нажатие себе.
 *
 * Проверяется поэтому не «видно ли вкладку», а КТО получит нажатие в её
 * середине. Геометрия соседей это пропускала: перекрытия по прямоугольникам
 * нет, потому что перекрывает невидимая часть обёртки.
 */
test.describe('вкладки номера ловят нажатие сами', () => {
  for (const view of VIEWPORTS) {
    for (const mode of ['dark', 'light'] as const) {
      test(`нажатие достаётся вкладке: ${view.name}, ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width: view.width, height: view.height })
        await enterRoom(page, mode)
        await page.goto('/room')
        await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 20_000 })
        await page.waitForTimeout(1200)

        const tabs = page.locator('[role="tab"]')
        const count = await tabs.count()
        test.skip(count === 0, 'у этого номера нет вкладок')

        // Позиции ЗА пределами начала страницы: именно там плита сжата и
        // обёртка успевает наехать на вкладки.
        for (const y of [0, 120, 200, 320, 500]) {
          await page.evaluate((to) => window.scrollTo(0, to), y)
          await page.waitForTimeout(250)

          const thieves = await page.evaluate(() => {
            const out: { tab: string; hit: string }[] = []
            for (const tab of document.querySelectorAll('[role="tab"]')) {
              const r = tab.getBoundingClientRect()
              // Вкладка уехала за экран — на этой позиции её не нажимают.
              if (r.bottom <= 0 || r.top >= window.innerHeight || r.width === 0) continue
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
              if (hit && (hit === tab || tab.contains(hit))) continue
              out.push({
                tab: tab.textContent ?? '?',
                hit: hit
                  ? hit.tagName.toLowerCase() +
                    (hit.getAttribute('data-testid') ? `[${hit.getAttribute('data-testid')}]` : '')
                  : '(никто)',
              })
            }
            return out
          })

          expect(
            thieves,
            `на скролле ${y} нажатие по вкладке достаётся не ей: ` +
              thieves.map((t) => `${t.tab} → ${t.hit}`).join(', '),
          ).toEqual([])
        }

        // И нажатие действительно переключает: проверка выше говорит «дойдёт»,
        // эта — «сработало».
        await page.evaluate(() => window.scrollTo(0, 320))
        await page.waitForTimeout(250)
        const last = tabs.nth(count - 1)
        await last.click()
        await expect(last).toHaveAttribute('aria-selected', 'true')
      })
    }
  }
})
