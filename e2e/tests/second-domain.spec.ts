import { expect, test } from './fixtures'

import { CREDENTIALS, DEMO_ROOM } from './helpers'

/**
 * ВТОРАЯ БАЗА АДРЕСОВ (партия 39).
 *
 * В деве вторая база — `naviroom.localhost` рядом с `guest.localhost`
 * (`GUEST_APP_BASE_DOMAINS` бэкенда и `VITE_APP_DOMAINS` сборки). Всё, что
 * работает под первой (`address-scheme.spec.ts`), обязано работать и под
 * второй: корень — лендинг и консоль, `<код>.<база>` — витрина гостя, панель
 * отеля, вход и живой сокет трекера (источник новой базы проходит проверку).
 */

const PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5183').port || '5183'
const ROOT = `http://naviroom.localhost:${PORT}`
const HOTEL = `http://crystal.naviroom.localhost:${PORT}`

test('корень второй базы — лендинг, а на /admin — консоль платформы', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })
  await page.goto(`${ROOT}/admin`)
  await expect(page.getByTestId('admin-login-email')).toBeVisible({ timeout: 30_000 })
})

test('отель под второй базой — гость по QR доходит до главной', async ({ page }) => {
  await page.goto(`${HOTEL}/r/${DEMO_ROOM}`)
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 30_000 })
})

test('отель под второй базой — вход сотрудника и живой сокет трекера', async ({ page }) => {
  const snapshots: string[] = []
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/tracker/')) return
    socket.on('framereceived', (frame) => {
      const text = typeof frame.payload === 'string' ? frame.payload : ''
      if (text.includes('"tracker.snapshot"')) snapshots.push(socket.url().replace(/token=[^&]+/, 'token=…'))
    })
  })
  await page.goto(`${HOTEL}/admin`)
  await expect(page.getByTestId('login-email')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('admin-login-email'), 'на адресе отеля — вход панели, не консоли').toHaveCount(0)
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/tracker/, { timeout: 30_000 })
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => snapshots.length, { timeout: 20_000, message: 'сокет доски с новой базы не получил снимок' }).toBeGreaterThan(0)
  expect(snapshots[0]).toContain('crystal.naviroom.localhost')
})
