import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signInToCms } from './helpers'

/**
 * ПРОБНОЕ ПИСЬМО ГОВОРИТ, КУДА УШЛО (партия 31, INV-01 QA).
 *
 * На стенде почтовый сервер — Mailpit: письмо принято, но ловится тестовым
 * ящиком, а не уходит адресату. Ответ «ок» QA прочитал как доставку и ждал
 * письмо в настоящей почте.
 */

test('пробная отправка почты на стенде — «ушло в тестовую почту (Mailpit)»', async ({ page, request }) => {
  const admin = await apiToken(request, ADMIN)
  const created = await request.post(`${API}/api/cms/notification-channels`, {
    headers: apiHeaders(admin),
    data: { type: 'email', title: `Почта ${Date.now().toString(36)}`, config: { to: ['qa@crystal.local'] } },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const channel = await created.json()
  try {
    await signInToCms(page, ADMIN)
    await page.goto('/cms/notifications')
    await page.getByTestId(`cms-channel-edit-${channel.id}`).click({ timeout: 20_000 })
    await page.getByTestId('cms-channel-test').click()
    await expect(page.getByTestId('cms-channel-test-result')).toContainText('тестовую почту стенда (Mailpit)', {
      timeout: 20_000,
    })
  } finally {
    await request.delete(`${API}/api/cms/notification-channels/${channel.id}`, { headers: apiHeaders(admin) })
  }
})
