import { type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, HOTEL } from './helpers'
import { brandSession, guestPage } from './brandGuest'

/**
 * СТИЛЬ ПОВЕРХНОСТИ — НА ВСЕ КАРТОЧКИ ВИТРИНЫ, БЕЗ СТЕКЛА ПОВЕРХ ФОТО (партия 25).
 *
 * «Плоский / мягкий / стекло» менял одну карточку из десятка — каталога. Погода,
 * панели номера, корзина, заказы, статус заказа красили себя сами.
 *
 * КАРТОЧКА здесь определена замером, а не списком компонентов: скруглённый
 * блок с фоном и текстом, не меньше 150×56 (карточка меню на телефоне — 169), не кнопка, не поле ввода, не
 * закреплённая полоса, не лист во всю ширину экрана и не вложенный в другую карточку (строка внутри карточки
 * — часть карточки). Новая карточка, нарисованная мимо рецепта, покраснеет
 * здесь сама.
 *
 * Правила: у каждой карточки вид при трёх стилях попарно различается; при
 * «стекле» у карточки поверх фото размытия подложки нет.
 */

type Card = { id: string; look: string; overPhoto: boolean; blur: string; what: string }

const MEASURE = (): Record<string, Card> => {
  const isCard = (el: Element): boolean => {
    const cs = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    if (box.width < 150 || box.height < 56) return false
    // Во всю ширину — это лист страницы (меню, наезжающее на фото заведения), а не карточка.
    if (box.width >= window.innerWidth - 1) return false
    if (el.closest('button, [role="button"], label') || el.querySelector('input, textarea')) return false
    if (cs.position === 'fixed' || cs.position === 'sticky') return false
    const bg = cs.backgroundColor
    const painted = (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || cs.backdropFilter !== 'none'
    return painted && parseFloat(cs.borderTopLeftRadius) >= 8 && !!(el.textContent ?? '').trim()
  }
  const out: Record<string, Card> = {}
  for (const el of document.querySelectorAll('main *, [data-testid="guest-item-sheet"] *')) {
    if (!isCard(el)) continue
    let nested = false
    let overPhoto = false
    for (let e = el.parentElement; e; e = e.parentElement) {
      if (isCard(e)) nested = true
      const bgImage = getComputedStyle(e).backgroundImage
      if (bgImage.includes('url(') && !bgImage.includes('data:image/svg')) overPhoto = true
    }
    if (nested) continue
    const cs = getComputedStyle(el)
    const path: string[] = []
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      path.unshift(`${e.tagName}${[...(e.parentElement?.children ?? [])].indexOf(e)}`)
    }
    out[path.join('/')] = {
      id: el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName,
      look: [cs.backgroundColor, cs.boxShadow, cs.backdropFilter, cs.borderTopWidth, cs.borderTopColor].join('|'),
      overPhoto,
      blur: cs.backdropFilter,
      what: `${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)} «${(el.textContent ?? '').trim().slice(0, 30)}»`,
    }
  }
  return out
}

async function placeOrder(request: APIRequestContext, token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
  const menu = await (await request.get(`${API}/api/v1/guest/catalog?type=product`, { headers })).json()
  const caesar = menu.categories
    .flatMap((c: { items: { id: string; code: string }[] }) => c.items)
    .find((i: { code: string }) => i.code === 'caesar')
  const placed = await request.post(`${API}/api/v1/guest/order`, {
    data: { lines: [{ item_id: caesar.id, quantity: 1 }], timing: 'asap' },
    headers: { ...headers, 'Idempotency-Key': `e2e-cards-${Date.now()}-${Math.random()}` },
  })
  expect(placed.ok(), await placed.text()).toBeTruthy()
  return (await placed.json()).id
}

async function walk(browser: Browser, request: APIRequestContext): Promise<Record<string, Record<string, Card>>> {
  const page: Page = await guestPage(browser)
  const token = (await page.evaluate(() => localStorage.getItem('itv.guest.token')))!
  const orderId = await placeOrder(request, token)
  const screens: Record<string, Record<string, Card>> = {}
  try {
    await expect(page.getByTestId('guest-home-weather')).toBeVisible({ timeout: 20_000 })
    screens['главная'] = await page.evaluate(MEASURE)
    await page.goto('/venue/kitchen')
    await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
    screens['меню'] = await page.evaluate(MEASURE)
    await page.getByTestId('guest-qty-plus-caesar').click()
    await page.getByTestId('guest-cart-button').first().click()
    await expect(page.getByTestId('guest-cart-line-caesar')).toBeVisible({ timeout: 20_000 })
    screens['корзина'] = await page.evaluate(MEASURE)
    await page.goto(`/orders/${orderId}`)
    await expect(page.getByTestId('guest-order-status')).toBeVisible({ timeout: 20_000 })
    screens['статус заказа'] = await page.evaluate(MEASURE)
    await page.goto('/orders')
    await expect(page.getByTestId(`guest-order-card-${orderId}`).or(page.locator('main')).first()).toBeVisible()
    await page.waitForTimeout(800)
    screens['заказы'] = await page.evaluate(MEASURE)
    await page.goto('/room')
    await expect(page.getByTestId('room-panel-quick')).toBeVisible({ timeout: 20_000 })
    screens['номер'] = await page.evaluate(MEASURE)
  } finally {
    await request.post(`${API}/api/v1/guest/order/${orderId}/cancel`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
      data: {},
    })
    await page.context().close()
  }
  return screens
}

test('стиль поверхности меняет каждую карточку витрины, стекла поверх фото нет', async ({ browser, request }) => {
  test.setTimeout(300_000)
  const brand = await brandSession(request)
  const failures: string[] = []
  let compared = 0
  try {
    const seen: Record<string, Record<string, Record<string, Card>>> = {}
    for (const style of ['flat', 'soft', 'glass'] as const) {
      await brand.apply({ brand: { surfaceStyle: style } })
      seen[style] = await walk(browser, request)
    }
    for (const [screen, flat] of Object.entries(seen.flat)) {
      for (const [key, card] of Object.entries(flat)) {
        const soft = seen.soft[screen]?.[key]
        const glass = seen.glass[screen]?.[key]
        if (!soft || !glass) continue
        compared++
        if (glass.overPhoto) {
          if (glass.blur !== 'none') failures.push(`${screen}: ${card.id} — стекло поверх фото`)
          continue
        }
        if (new Set([card.look, soft.look, glass.look]).size < 3) {
          failures.push(`${screen}: ${card.id} ${card.what} — не слушает стиль поверхности`)
        }
      }
    }
  } finally {
    await brand.restore()
  }
  expect([...new Set(failures)], 'карточки мимо стиля поверхности').toEqual([])
  expect(compared, 'карточек не нашлось — замер пуст').toBeGreaterThan(10)
})
