import { expect, test, type Page } from '@playwright/test'

import { API } from './helpers'

/**
 * Флот из трёх отелей глазами гостя — доказательство white-label.
 *
 * Витрина собирается с зашитым поддоменом (`VITE_HOTEL_SUBDOMAIN`, по
 * умолчанию `crystal`): в проде тенант приходит из имени хоста, а на дев-стенде
 * — заголовком. Поэтому здесь заголовок подменяется на лету, а не поднимается
 * вторая сборка фронта: проверять надо ту же самую витрину, а не её копию,
 * собранную под другой отель.
 *
 * Что доказываем: у каждого отеля СВОИ имя, бренд и заведения. Если бы витрина
 * показывала одно и то же, мультитенантность существовала бы только в базе.
 */

/** Заставить страницу ходить в API от имени другого отеля. */
async function asHotel(page: Page, subdomain: string): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const headers = { ...route.request().headers(), 'x-hotel-subdomain': subdomain }
    await route.continue({ headers })
  })
}

async function enterBrowsing(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-browse-only').click()
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 20_000 })
}

const FLEET = [
  {
    subdomain: 'crystal',
    name: 'Кристалл',
    // Заведения, которых нет у соседей: по ним видно, что витрина не общая.
    own: 'guest-home-tile-kitchen',
    foreign: ['guest-home-tile-marina', 'guest-home-tile-bistro'],
  },
  {
    subdomain: 'azure',
    name: 'Азур',
    own: 'guest-home-tile-marina',
    foreign: ['guest-home-tile-kitchen', 'guest-home-tile-bistro'],
  },
  {
    subdomain: 'lumen',
    name: 'Люмен',
    own: 'guest-home-tile-bistro',
    foreign: ['guest-home-tile-kitchen', 'guest-home-tile-marina'],
  },
]

test.describe('Флот: три отеля, три витрины', () => {
  for (const hotel of FLEET) {
    test(`${hotel.subdomain}: гость видит свой отель и не видит чужие`, async ({ page }) => {
      await asHotel(page, hotel.subdomain)
      await enterBrowsing(page)

      // Имя отеля — на своём месте, а не соседское.
      await expect(page.getByTestId('guest-topbar-brand')).toContainText(hotel.name)

      // Своё заведение есть.
      await expect(page.getByTestId(hotel.own)).toBeVisible({ timeout: 15_000 })

      // Чужих нет. Это и есть изоляция со стороны гостя.
      for (const foreign of hotel.foreign) {
        await expect(page.getByTestId(foreign)).toHaveCount(0)
      }
    })
  }

  test('у трёх отелей три разных бренда', async ({ request }) => {
    const presets = new Map<string, string>()
    for (const hotel of FLEET) {
      const response = await request.get(`${API}/api/v1/guest/hotel?lang=ru`, {
        headers: { 'X-Hotel-Subdomain': hotel.subdomain },
      })
      expect(response.ok(), await response.text()).toBeTruthy()
      const body = (await response.json()) as {
        name: string
        theme: { preset?: string; brand?: { background?: { imageUrl?: string } } }
      }
      expect(body.name).toContain(hotel.name)
      // Обложка у каждого своя и настоящая — не заглушка.
      expect(body.theme.brand?.background?.imageUrl, `${hotel.subdomain}: обложка`).toBeTruthy()
      presets.set(hotel.subdomain, body.theme.preset ?? '')
    }
    expect(new Set(presets.values()).size, `пресеты: ${[...presets]}`).toBe(3)
  })

  test('рум-сервис курорта показывает меню ресторана — кросс-ссылка', async ({ page }) => {
    await asHotel(page, 'azure')
    await enterBrowsing(page)

    // Рум-сервис своего меню не имеет: всё, что в нём есть, заимствовано у
    // «Марины». Если бы ссылка не работала, заведение открылось бы пустым.
    await page.getByTestId('guest-home-tile-azure-room-service').click()
    await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('guest-item-seabass')).toBeVisible({ timeout: 15_000 })
  })
})
