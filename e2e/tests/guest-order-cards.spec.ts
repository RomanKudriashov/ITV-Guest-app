import { expect, test, type Page } from '@playwright/test'

import { DEMO_ROOM } from './helpers'

/**
 * Карточка заявки — по виду, а не одна на всех.
 *
 * Первая проверка живая: заявка консьержу оформляется через форму, и вид
 * карточки приходит С СЕРВЕРА — из того же реестра, по которому персоналу
 * достаётся доска. Остальные три вида проверяются подменой ОДНОГО поля
 * ответа: снимается раскладка, и подмена честнее сида — сервиса типа
 * `transfer` (карточка поездки) нет ни у одного демо-отеля, трансфер живёт
 * разделом консьержа.
 */

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
}

/** Заявка консьержу: возвращает адрес её карточки. */
async function placeConciergeRequest(page: Page): Promise<string> {
  await page.goto('/venue/concierge')
  await page.getByTestId('guest-service-city-tour').click()
  await expect(page.getByTestId('guest-request-form')).toBeVisible()
  await expect(page.getByTestId('guest-field-date')).toBeVisible()

  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
  await page.getByTestId('guest-field-date').fill(day)
  await page.getByTestId('guest-request-submit').click()

  await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('guest-track-order').click()
  await expect(page.getByTestId('guest-order-facts')).toBeVisible({ timeout: 20_000 })
  return page.url()
}

test.describe('Гость: карточка заявки по виду', () => {
  test('заявка консьержу приходит заявкой и не обещает время подачи', async ({ page }) => {
    await enterAsGuest(page)
    await placeConciergeRequest(page)

    await expect(page.getByTestId('guest-order-facts')).toHaveAttribute('data-kind', 'request')
    // «Подадим к» и ETA — свойства ДОСТАВКИ. У экскурсии их никто не обещал.
    await expect(page.getByTestId('guest-serve-by')).toHaveCount(0)
    await expect(page.getByTestId('guest-order-eta')).toHaveCount(0)
    await expect(page.getByTestId('guest-order-facts')).toContainText('Что просили')
  })

  test('запись, поездка и доставка раскладываются каждая по-своему', async ({ page }) => {
    await enterAsGuest(page)
    const url = await placeConciergeRequest(page)

    // Живой сокет молчит: он присылает НАСТОЯЩИЙ заказ и возвращает подменённый
    // вид обратно. Без этого проверка зависит от того, кто успел первым.
    //
    // Адрес — с версией: `/ws/v1/guest/order/…` (WS_BASE в api/client.ts).
    // Первая версия глушила `/ws/guest/order/` и не совпадала НИ РАЗУ, отчего
    // первая подмена проходила (успевала до снимка из сокета), а вторая — нет.
    await page.routeWebSocket(/\/ws\/v1\/guest\/order\//, () => {})

    // Перехват ставится ОДИН раз, а вид меняется переменной: перерегистрация
    // на каждый вид оставляла прежний ответ в кэше браузера, и вторая подмена
    // не доезжала. По той же причине ответ отдаётся с `no-store`.
    let override = ''
    await page.route('**/guest/order/*', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({
        json: { ...body, card_kind: override || body.card_kind },
        headers: { 'cache-control': 'no-store' },
      })
    })

    /** Открыть ту же заявку, подменив в ответе ТОЛЬКО вид карточки. */
    const reopenAs = async (kind: string) => {
      override = kind
      // Полная перезагрузка, а не переход внутри приложения: иначе страница
      // соберётся из уже загруженного ответа и подмена ничего не изменит.
      await page.goto('about:blank')
      await page.goto(url)
      await expect(page.getByTestId('guest-order-facts')).toHaveAttribute('data-kind', kind, {
        timeout: 20_000,
      })
    }

    await reopenAs('booking')
    // У записи нет ни обещания подачи, ни ETA: время сеанса назначено.
    await expect(page.getByTestId('guest-serve-by')).toHaveCount(0)
    await expect(page.getByTestId('guest-order-eta')).toHaveCount(0)

    await reopenAs('ride')
    await expect(page.getByTestId('guest-order-facts')).toContainText('Подача')
    await expect(page.getByTestId('guest-order-eta')).toHaveCount(0)

    await reopenAs('delivery')
    // И только у доставки осмысленно «когда» с обещанием подачи.
    await expect(page.getByTestId('guest-order-facts')).toContainText('Когда')

    await page.unroute('**/guest/order/*')
  })
})

/**
 * ОПИСАНИЕ В КАРТОЧКЕ БЛЮДА — ПО ВЫСОТЕ ТЕКСТА.
 *
 * Здесь стояла резервация под две строки (`minHeight: 32`). На демо-меню
 * однострочны ВСЕ описания, и под каждым висела пустая строка: стеклянная
 * подложка была вдвое выше текста и читалась незакрытой.
 *
 * Запас держали ради ровного ряда — и напрасно: ряд равняет сетка, а не запас
 * внутри карточки. Укус проверяет ОБА свойства сразу, потому что порознь они
 * ничего не стоят: высота по тексту без ровного ряда — рваная витрина, ровный
 * ряд с запасом — то, что чинили.
 */
test('описание в карточке блюда занимает столько строк, сколько в нём есть', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await enterAsGuest(page)
  await page.getByTestId('guest-home-tile-kitchen').click()
  await expect(page.getByTestId('guest-venue')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)

  const cards = await page.evaluate(() => {
    /** Сколько строк текст занимает НА САМОМ ДЕЛЕ: по прямоугольникам диапазона. */
    const lineCount = (node: HTMLElement): number => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return new Set(
        Array.from(range.getClientRects())
          .filter((rect) => rect.height > 1)
          .map((rect) => Math.round(rect.top)),
      ).size
    }
    return Array.from(document.querySelectorAll('[data-testid^="guest-item-"]'))
      .filter((node) => (node as HTMLElement).offsetHeight > 100)
      .map((node) => {
        const card = node as HTMLElement
        const desc = Array.from(card.querySelectorAll('p, div')).find((child) => {
          const style = getComputedStyle(child)
          return style.webkitLineClamp !== 'none' || style.display === '-webkit-box'
        }) as HTMLElement | undefined
        return {
          id: card.dataset.testid ?? '?',
          top: Math.round(card.getBoundingClientRect().top),
          height: Math.round(card.getBoundingClientRect().height),
          desc: desc
            ? {
                height: Math.round(desc.getBoundingClientRect().height),
                line: parseFloat(getComputedStyle(desc).lineHeight),
                // Обрезка по второй строке остаётся: она про длинное описание,
                // а не про выравнивание.
                lines: Math.min(lineCount(desc), 2),
              }
            : null,
        }
      })
  })
  expect(cards.length, 'в меню не нашлось карточек').toBeGreaterThan(3)

  for (const card of cards) {
    if (!card.desc) continue
    const expected = card.desc.lines * card.desc.line
    expect(
      Math.abs(card.desc.height - expected),
      `${card.id}: под описание в ${card.desc.lines} стр. отведено ${card.desc.height}px вместо ${Math.round(expected)}px`,
    ).toBeLessThanOrEqual(2)
  }

  // …и при этом ряд остаётся ровным: его равняет сетка.
  const rows = new Map<number, number[]>()
  for (const card of cards) {
    const key = Math.round(card.top / 20)
    rows.set(key, [...(rows.get(key) ?? []), card.height])
  }
  let checked = 0
  for (const [, heights] of rows) {
    if (heights.length < 2) continue
    checked += 1
    expect(
      Math.max(...heights) - Math.min(...heights),
      `карточки в ряду разной высоты: ${heights.join(', ')}`,
    ).toBeLessThanOrEqual(1)
  }
  expect(checked, 'ни одного ряда из нескольких карточек — проверять было нечего').toBeGreaterThan(0)
})
