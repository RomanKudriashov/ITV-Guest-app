import { expect, test } from './fixtures'

import { API, apiHeaders, apiToken, signIn } from './helpers'

/**
 * ТОЧКА ГЛАВНОГО ВМЕСТО РАМКИ КАДРА (партия 58в).
 *
 * Рамка резала фото под одну форму, а гость видит его в десятке форм. Теперь
 * человек кликом (или стрелками) отмечает главное, рядом — все места роли на
 * 1440 и 390 тем же `KitImage`, что у гостя; место «целиком» с долей < 60 % и
 * место, которому не хватает оригинала, — с красной меткой.
 *
 * Проект `own-hotel`: точка пишется в ассет — на своём отеле прогона.
 */

/** Вертикальная картинка 200×600: в широкой рамке ей нечем быть, кроме полосы. */
function tallPng(): Buffer {
  // 1×1 PNG растягивать нельзя — нужен настоящий размер, иначе кроппер не с чем
  // работать. Рисуем полосатый градиент прямо здесь, без внешних файлов.
  const width = 200
  const height = 600
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      raw[i] = (x * 255) / width
      raw[i + 1] = (y * 255) / height
      raw[i + 2] = ((x + y) * 255) / (width + height)
    }
  }
  return encodePng(width, height, raw)
}

/** Минимальный PNG-энкодер: три чанка и zlib. Библиотеку ради теста не тащим. */
function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const zlib = require('node:zlib')
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 3 + 1)] = 0
    rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let table: number[] | null = null
function crc32(buf: Buffer): number {
  if (!table) {
    table = []
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return crc ^ -1
}


async function tallAsset(request: import('@playwright/test').APIRequestContext, token: string) {
  const uploaded = await request.post(`${API}/api/v1/cms/media`, {
    multipart: {
      file: { name: 'e2e-tall.png', mimeType: 'image/png', buffer: tallPng() },
      kind: 'item',
    },
    headers: apiHeaders(token),
  })
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy()
  const id = (await uploaded.json()).id as string
  // Нарезка в воркере — ждём готовности.
  await expect
    .poll(async () => (await (await request.get(`${API}/api/v1/cms/media/${id}`, { headers: apiHeaders(token) })).json()).status, {
      timeout: 30_000,
    })
    .toBe('ready')
  return id
}

test.describe('Точка главного', () => {
  test.slow()

  test('API: точка сохраняется, нарезка не перезапускается, рамки нет', async ({ request }) => {
    const token = await apiToken(request)
    const id = await tallAsset(request, token)
    const before = await (await request.get(`${API}/api/v1/cms/media/${id}`, { headers: apiHeaders(token) })).json()
    expect(before.focus).toEqual({ x: 0.5, y: 0.5 })
    expect(before).not.toHaveProperty('crop')
    const saved = await request.put(`${API}/api/v1/cms/media/${id}/focus`, {
      data: { x: 0.5, y: 0.2 },
      headers: apiHeaders(token),
    })
    expect(saved.ok(), await saved.text()).toBeTruthy()
    const body = await saved.json()
    expect(body.status).toBe('ready')
    expect(body.ref.focus).toEqual({ x: 0.5, y: 0.2 })
    // Старой ручки рамки больше нет.
    const old = await request.put(`${API}/api/v1/cms/media/${id}/crop`, {
      data: { crop: { x: 0, y: 0, w: 1, h: 1 }, ratio: 1 },
      headers: apiHeaders(token),
    })
    expect([404, 405]).toContain(old.status())
  })

  for (const width of [1440, 390]) {
    test(`редактор (${width}): клик и стрелки двигают точку, места живые, красные метки, слабый оригинал`, async ({ page, request }) => {
      const token = await apiToken(request)
      const items = await (await request.get(`${API}/api/cms/items?limit=500`, { headers: apiHeaders(token) })).json()
      const caesar = (items.items ?? items).find((row: { code: string }) => row.code === 'caesar')
      expect(caesar, 'нет «Цезаря»').toBeTruthy()

      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await signIn(page)
      await page.goto(`/cms/menu/items/${caesar.id}`)
      // Вертикальная 200×600 — загрузкой в форме позиции, как человек.
      const uploaded = page.waitForResponse(
        (r) => /\/cms\/media$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      )
      await page.locator('[data-testid="image-uploader-input"]').setInputFiles({
        name: 'e2e-tall.png',
        mimeType: 'image/png',
        buffer: tallPng(),
      })
      const assetId = (await (await uploaded).json()).id as string
      // Кнопка — только у нарезанного фото: до этого у него нет формы кадра.
      const focusButton = page.getByTestId(`media-focus-${assetId}`)
      await expect(focusButton).toBeVisible({ timeout: 40_000 })

      // Слабый оригинал: 200 px против самого крупного места позиции — без запрета.
      await expect(page.getByTestId(`media-weak-${assetId}`)).toContainText(/px/)

      await focusButton.click()
      const stage = page.getByTestId('focus-stage')
      await expect(stage).toBeVisible()
      // Окно позиции — место «целиком»: 1:3 в 16:9 видно < 60 % — красная метка.
      await expect(page.getByTestId('place-window-wide')).toHaveAttribute('data-bad', 'true')
      await expect(page.getByTestId('place-window-wide-whole')).toBeVisible()
      // Шапке не хватает 200 px оригинала — подсказка с числом.
      await expect(page.getByTestId('place-card-wide-weak')).toContainText(/\d+ px/)

      // Клик в верхнюю пятую — точка и превью мест сдвигаются сразу.
      const box = (await stage.boundingBox())!
      await stage.click({ position: { x: box.width / 2, y: box.height * 0.2 } })
      await expect.poll(async () => Number(await stage.getAttribute('data-focus-y'))).toBeLessThan(0.25)
      const card = page.getByTestId('place-card-wide').locator('img').first()
      // Превью места сдвигается вместе с точкой: object-position ≈ «50% 20%».
      await expect
        .poll(async () => Number((await card.evaluate((img) => getComputedStyle(img).objectPosition)).split(' ')[1].replace('%', '')))
        .toBeLessThan(25)
      // Стрелка вниз с Shift — шаг 10 %.
      await stage.press('Shift+ArrowDown')
      await expect.poll(async () => Number(await stage.getAttribute('data-focus-y'))).toBeGreaterThan(0.25)
      const y = Number(await stage.getAttribute('data-focus-y'))
      await stage.press('Enter')
      await expect(page.getByTestId('focus-editor')).toBeHidden()

      const asset = await (await request.get(`${API}/api/v1/cms/media/${assetId}`, { headers: apiHeaders(token) })).json()
      expect(asset.focus.y).toBeCloseTo(y, 3)
    })
  }
})
