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
