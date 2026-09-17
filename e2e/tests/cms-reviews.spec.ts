import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import {
  ADMIN,
  API,
  HOTEL,
  apiHeaders,
  apiToken,
  guestSession,
  moveOrderStatus,
  signInToCms,
  staffToken,
} from './helpers'

/**
 * Раздел «Отзывы» в CMS: список с фильтром, ответ гостю и честное
 * «ответ не дойдёт», когда гость уже выехал.
 *
 * Отзывы заводятся через API гостя — тем же путём, что у живого гостя:
 * заказ → кухня закрывает → оценка. Сев стенда пишет отзывы мимо сервиса, и
 * по ним не проверить ни событие, ни ответ.
 */

const SPA_MANAGER = { email: 'manager.spa@crystal.local', password: 'chef12345' }

function guestHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
}

async function reviewedOrder(
  request: APIRequestContext,
  staff: string,
  room: string,
  rating: number,
  comment: string,
  chat?: string,
): Promise<{ guest: string; number: number; reviewId: string }> {
  const guest = await guestSession(request, room)
  const menu = await (
    await request.get(`${API}/api/guest/catalog?type=product`, { headers: guestHeaders(guest) })
  ).json()
  const caesar = menu.categories
    .flatMap((category: { items: { id: string; code: string }[] }) => category.items)
    .find((item: { code: string }) => item.code === 'caesar')
  const placed = await request.post(`${API}/api/guest/order`, {
    data: { lines: [{ item_id: caesar.id, quantity: 1 }], timing: 'asap' },
    headers: { ...guestHeaders(guest), 'Idempotency-Key': `rev-${Date.now()}-${Math.random()}` },
  })
  expect(placed.ok(), await placed.text()).toBeTruthy()
  const order = await placed.json()
  if (chat) {
    const sent = await request.post(`${API}/api/guest/chat`, {
      data: { body: chat },
      headers: guestHeaders(guest),
    })
    expect(sent.ok(), await sent.text()).toBeTruthy()
  }
  await moveOrderStatus(request, staff, order.id, 'done')
  const review = await request.post(`${API}/api/guest/order/${order.id}/review`, {
    data: { rating, comment },
    headers: guestHeaders(guest),
  })
  expect(review.ok(), await review.text()).toBeTruthy()
  return { guest, number: order.number, reviewId: (await review.json()).id }
}

async function checkOut(request: APIRequestContext, admin: string, room: string): Promise<void> {
  const rooms = await (
    await request.get(`${API}/api/cms/rooms?search=${room}`, { headers: apiHeaders(admin) })
  ).json()
  const target = (rooms.items ?? rooms).find((row: { number: string }) => row.number === room)
  expect(target, `номер ${room} есть в демо`).toBeTruthy()
  const done = await request.post(`${API}/api/cms/rooms/${target.id}/checkout`, {
    headers: apiHeaders(admin),
  })
  expect(done.ok(), await done.text()).toBeTruthy()
}

test.describe('CMS: раздел «Отзывы»', () => {
  test('ответ гостю, который ещё здесь, уходит в его чат', async ({ page, request }) => {
    const admin = await apiToken(request)
    const comment = `холодный суп ${Date.now().toString(36)}`
    const { guest, number } = await reviewedOrder(request, admin, '305', 2, comment)

    await signInToCms(page, ADMIN)
    await page.getByTestId('cms-nav-reviews').click()
    await expect(page.getByTestId('cms-reviews')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('reviews-count')).toContainText(/[1-9]/, { timeout: 15_000 })

    const row = page.getByTestId(`reviews-row-${number}`)
    await expect(row).toContainText(comment, { timeout: 15_000 })
    await expect(row).toContainText('Низкая')

    await row.getByTestId(`reviews-reply-open-${number}`).click()
    await expect(row.getByTestId(`reviews-unreachable-${number}`)).toHaveCount(0)
    await row.getByTestId(`reviews-reply-input-${number}`).fill('Простите, уже разбираемся')
    await row.getByTestId(`reviews-reply-send-${number}`).click()
    await expect(row.getByTestId(`reviews-reply-status-${number}`)).toContainText(
      'Отправлено гостю в чат',
      { timeout: 15_000 },
    )

    // Дошло по-настоящему: сообщение лежит в чате гостя.
    const chat = await (
      await request.get(`${API}/api/guest/chat`, { headers: guestHeaders(guest) })
    ).json()
    expect(
      chat.messages.some(
        (m: { body: string; author_type: string }) =>
          m.body === 'Простите, уже разбираемся' && m.author_type === 'staff',
      ),
    ).toBeTruthy()
  })

  test('гость выехал — экран говорит это ДО ответа, и ответ только хранится', async ({
    page,
    request,
  }) => {
    const admin = await apiToken(request)
    const comment = `долго ждали ${Date.now().toString(36)}`
    const { number } = await reviewedOrder(request, admin, '212', 1, comment)
    await checkOut(request, admin, '212')

    await signInToCms(page, ADMIN)
    await page.goto('/cms/reviews?rating=low')
    const row = page.getByTestId(`reviews-row-${number}`)
    await expect(row).toContainText(comment, { timeout: 20_000 })

    await row.getByTestId(`reviews-reply-open-${number}`).click()
    await expect(row.getByTestId(`reviews-unreachable-${number}`)).toBeVisible()
    await row.getByTestId(`reviews-reply-input-${number}`).fill('Жаль, что так вышло')
    await row.getByTestId(`reviews-reply-send-${number}`).click()
    await expect(row.getByTestId(`reviews-reply-status-${number}`)).toContainText('Не доставлено', {
      timeout: 15_000,
    })
  })

  test('разбор: заказ, часть, кто вёл, в срок ли и что гость писал в чат', async ({
    page,
    request,
  }) => {
    const admin = await apiToken(request)
    const chat = `где мой заказ ${Date.now().toString(36)}`
    const { number } = await reviewedOrder(request, admin, '305', 1, 'так и не дождались', chat)

    await signInToCms(page, ADMIN)
    await page.goto('/cms/reviews?rating=low')
    const row = page.getByTestId(`reviews-row-${number}`)
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.getByTestId(`reviews-investigate-${number}`).click()

    const panel = page.getByTestId('review-investigation')
    await expect(panel.getByTestId('review-investigation-head')).toContainText(`№${number}`, {
      timeout: 15_000,
    })
    await expect(panel.getByTestId(`review-part-${number}`)).toContainText('Вёл:')
    // Закрыли сразу — в срок; порог — снимок на момент заказа.
    await expect(panel.getByTestId(`review-part-intime-${number}`)).toBeVisible()
    await expect(panel.getByTestId(`review-part-escalations-${number}`)).toContainText(
      'Эскалаций не было',
    )
    await expect(panel.getByTestId('review-investigation-chat')).toContainText(chat)

    await panel.getByTestId('review-investigation-close').click()
    await expect(panel).toBeHidden()
  })

  test('разбор: новый → разбирается → закрыт со словами, и отзыв уходит из очереди', async ({
    page,
    request,
  }) => {
    const admin = await apiToken(request)
    const { number } = await reviewedOrder(request, admin, '305', 1, `разбор ${Date.now().toString(36)}`)

    await signInToCms(page, ADMIN)
    await page.goto('/cms/reviews?triage=open')
    const row = page.getByTestId(`reviews-row-${number}`)
    await expect(row.getByTestId(`reviews-triage-${number}`)).toHaveText('Новый', { timeout: 20_000 })

    await row.getByTestId(`reviews-investigate-${number}`).click()
    const panel = page.getByTestId('review-investigation')
    const triage = panel.getByTestId('review-triage')
    await triage.getByTestId('review-triage-take').click()
    await expect(triage.getByTestId('review-triage-status')).toHaveText('Разбирается', {
      timeout: 15_000,
    })

    // Без слов закрыть нельзя — кнопка не нажимается.
    await expect(triage.getByTestId('review-triage-close')).toBeDisabled()
    await triage.getByTestId('review-triage-comment').fill('Повару замечание, гостю — десерт')
    await triage.getByTestId('review-triage-close').click()
    await expect(triage.getByTestId('review-triage-status')).toHaveText('Закрыт', { timeout: 15_000 })
    await expect(triage.getByTestId('review-triage-history')).toContainText('Повару замечание')
    await expect(row.getByTestId(`reviews-triage-${number}`)).toHaveText('Закрыт')

    await panel.getByTestId('review-investigation-close').click()
    await page.reload()
    await expect(page.getByTestId('cms-reviews')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('reviews-awaiting')).toBeVisible()
    await expect(page.getByTestId(`reviews-row-${number}`)).toHaveCount(0)
  })

  test('фильтр «только низкие» и чужое заведение', async ({ page, request }) => {
    const admin = await apiToken(request)
    const high = await reviewedOrder(request, admin, '305', 5, `всё супер ${Date.now().toString(36)}`)

    await signInToCms(page, ADMIN)
    await page.goto('/cms/reviews')
    await expect(page.getByTestId(`reviews-row-${high.number}`)).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('reviews-filter-rating').click()
    await page.getByTestId('reviews-filter-rating-low').click()
    await expect(page).toHaveURL(/rating=low/)
    await expect(page.getByTestId(`reviews-row-${high.number}`)).toHaveCount(0)
    const lows = page.locator('[data-testid^="reviews-rating-"]')
    await expect(lows.first()).toBeVisible()

    // Управляющий спа отзыва о кухне не видит — фильтр прав на сервере.
    const spa = await staffToken(request, SPA_MANAGER)
    const body = await (
      await request.get(`${API}/api/cms/reviews?limit=100`, { headers: apiHeaders(spa) })
    ).json()
    expect(body.items.some((item: { id: string }) => item.id === high.reviewId)).toBeFalsy()
    await request.post(`${API}/api/staff/auth/logout`, { headers: apiHeaders(spa) })
  })
})
