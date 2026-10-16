import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, PLATFORM, RECEPTION, guestSession, signIn } from './helpers'

/**
 * ПОДПИСИ ПОЛЕЙ: ВИДНЫ ЦЕЛИКОМ И СТОЯТ ПО ЦЕНТРУ (партия 54).
 *
 * Два дефекта, найденные замером:
 *   — поднятая подпись первого поля в окне срезалась краем содержимого
 *     окна: MUI обнуляет его верхний отступ после заголовка и режет всё, что
 *     выше («Причина входа» — видна нижняя треть);
 *   — пустая подпись стояла на 2,4–3 px ниже центра поля: высоту поля тема
 *     уменьшила, а положение подписи — нет.
 *
 * Проверка — геометрией, а не наличием элемента: «подпись есть» было правдой
 * и тогда, когда от неё оставалась треть. Три поверхности — консоль, CMS,
 * трекер: у всех одна тема полей (`theme/density`), но разные окна.
 */

const ROOT_PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5183').port || '5183'
const ROOT = `http://guest.localhost:${ROOT_PORT}`

type LabelGeometry = {
  label: string
  shrunk: boolean
  multiline: boolean
  /** На сколько пикселей подпись выходит за обрезающего предка (>0 — срезана). */
  cut: number
  /** Центр пустой подписи минус центр поля. */
  offCenter: number
}

/** Геометрия всех подписей в открытом окне. */
async function labels(page: Page): Promise<LabelGeometry[]> {
  // Подпись двигается анимацией (~200 мс): мерить — когда встала.
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const out: LabelGeometry[] = []
    for (const label of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] .MuiInputLabel-root'))) {
      const box = label.getBoundingClientRect()
      if (!box.width) continue
      // Ближайший предок, который режет содержимое.
      let clip: HTMLElement | null = label.parentElement
      while (clip) {
        const style = getComputedStyle(clip)
        if (style.overflow !== 'visible' || style.overflowY !== 'visible') break
        clip = clip.parentElement
      }
      let cut = 0
      if (clip) {
        const c = clip.getBoundingClientRect()
        const top = c.top + clip.clientTop
        const left = c.left + clip.clientLeft
        cut = Math.max(top - box.top, left - box.left, box.bottom - (top + clip.clientHeight), 0)
      }
      const root = label.parentElement?.querySelector<HTMLElement>('.MuiInputBase-root')
      const field = root?.getBoundingClientRect()
      out.push({
        label: (label.textContent ?? '').trim(),
        shrunk: label.dataset.shrink === 'true',
        multiline: Boolean(root?.classList.contains('MuiInputBase-multiline')),
        cut: Math.round(cut * 10) / 10,
        offCenter: field ? Math.round((box.top + box.height / 2 - (field.top + field.height / 2)) * 10) / 10 : 0,
      })
    }
    return out
  })
}

function assertLabels(where: string, found: LabelGeometry[]): void {
  expect(found.length, `${where}: подписей не нашлось — проверке не о чем`).toBeGreaterThan(0)
  for (const one of found) {
    expect(one.cut, `${where}: подпись «${one.label}» срезана на ${one.cut} px`).toBeLessThanOrEqual(0.5)
    if (!one.shrunk && !one.multiline) {
      expect(Math.abs(one.offCenter), `${where}: пустая «${one.label}» не по центру (${one.offCenter} px)`).toBeLessThanOrEqual(1.5)
    }
  }
}

async function loginConsole(page: Page): Promise<void> {
  await page.goto(`${ROOT}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
}

test('NaviRoom Control: «Новый отель» — пустые по центру, поднятые не срезаны', async ({ page }) => {
  await loginConsole(page)
  await page.goto(`${ROOT}/admin?section=fleet`)
  await page.getByTestId('admin-create-open').click()
  await expect(page.getByTestId('admin-create-name')).toBeVisible({ timeout: 15_000 })
  assertLabels('Новый отель, пусто', await labels(page))

  // Первое поле окна — то, чью подпись срезало: вводим и меряем поднятую.
  await page.getByTestId('admin-create-name').fill('Проверка подписи')
  await page.getByTestId('admin-create-subdomain').fill('labelcheck')
  const typed = await labels(page)
  expect(typed.find((one) => one.shrunk && /Название|Name/.test(one.label)), 'подпись «Название» не поднялась').toBeTruthy()
  assertLabels('Новый отель, введено', typed)
})

test('NaviRoom Control: «Войти в отель» — «Причина входа» видна целиком', async ({ page }) => {
  await loginConsole(page)
  await page.goto(`${ROOT}/admin?section=fleet`)
  await page.getByTestId(`admin-fleet-row-${HOTEL}`).getByRole('button').first().click()
  await page.getByTestId('admin-hotel-enter').click()
  await page.getByTestId('admin-enter-reason').fill('проверка подписи')
  assertLabels('Войти в отель', await labels(page))
  await page.keyboard.press('Escape')
})

test('CMS: «Новый сервис» — подписи видны и по центру', async ({ page }) => {
  await signIn(page, ADMIN)
  await page.goto('/cms/services')
  await page.getByTestId('services-add').click()
  await expect(page.getByTestId('service-create-name')).toBeVisible({ timeout: 15_000 })
  assertLabels('Новый сервис, пусто', await labels(page))
  await page.getByTestId('service-create-name').fill('Проверка подписи')
  assertLabels('Новый сервис, введено', await labels(page))
})

test('трекер: «Передать задачу» на стойке — подписи видны и по центру', async ({ page, request }) => {
  const token = await guestSession(request, '212')
  const message = await request.post(`${API}/api/guest/chat`, {
    data: { body: `подпись ${Date.now().toString(36)}` },
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(message.ok(), await message.text()).toBeTruthy()
  const threadId = (await message.json()).thread_id

  await signIn(page, RECEPTION)
  await page.goto(`/tracker/desk?t=${threadId}`)
  await page.getByTestId('desk-task-open').click()
  await expect(page.getByTestId('desk-task-dialog')).toBeVisible({ timeout: 15_000 })
  assertLabels('Передать задачу, пусто', await labels(page))
  await page.getByTestId('desk-task-text').fill('проверка подписи')
  assertLabels('Передать задачу, введено', await labels(page))
})
