import { expect, test } from '@playwright/test'

import { API, apiHeaders, apiToken } from './helpers'

/**
 * КАДР ВЫБИРАЕТ ЧЕЛОВЕК, А НЕ `object-fit`.
 *
 * До этого варианты резались пропорционально, а рамку доделывал браузер — брал
 * центр. Вертикальная фотография в широкой обложке теряла верх и низ молча, и
 * узнавал об этом гость.
 *
 * Три укуса:
 *   1. вертикальную картинку кладём в широкую обложку — видно, что обрежется;
 *   2. переоткрываем обрезку — исходник на месте, рамка прежняя;
 *   3. гость видит ровно то, что было в превью.
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

test.describe('Кадр изображения', () => {
  test.slow()

  test('вертикальная картинка в широкой обложке — видно, что обрежется', async ({
    request,
  }) => {
    const token = await apiToken(request)
    // Ассет заводим через API: тест про КАДР, а не про drag-and-drop файла.
    const uploaded = await request.post(`${API}/api/v1/cms/media`, {
      multipart: {
        file: { name: 'tall.png', mimeType: 'image/png', buffer: tallPng() },
        kind: 'category',
      },
      headers: apiHeaders(token),
    })
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy()
    const asset = await uploaded.json()

    // ИСХОДНИК отдаётся редактору — без него обрезать нечего.
    expect(asset.original_url, 'редактору кадра нечего открыть').toBeTruthy()
    expect(asset.crop, 'у свежей картинки кадра быть не должно').toBeNull()

    // Кладём вертикальную картинку в широкую рамку: по высоте влезает лишь
    // часть, и это ровно то, что человек обязан увидеть до сохранения.
    const applied = await request.put(`${API}/api/v1/cms/media/${asset.id}/crop`, {
      data: { crop: { x: 0, y: 0.25, w: 1, h: 0.2 }, ratio: 390 / 252 },
      headers: apiHeaders(token),
    })
    expect(applied.ok(), await applied.text()).toBeTruthy()
    const body = await applied.json()
    expect(body.crop).toEqual({ x: 0, y: 0.25, w: 1, h: 0.2 })
    // Обрезается 80% высоты — и это записано, а не подразумевается.
    expect(1 - body.crop.h).toBeCloseTo(0.8, 5)
    expect(body.status).toBe('pending')
  })

  test('переоткрыть обрезку — исходник на месте, рамка прежняя', async ({ request }) => {
    const token = await apiToken(request)
    const asset = await request
      .post(`${API}/api/v1/cms/media`, {
        multipart: {
          file: { name: 'tall.png', mimeType: 'image/png', buffer: tallPng() },
          kind: 'category',
        },
        headers: apiHeaders(token),
      })
      .then((r) => r.json())

    await request.put(`${API}/api/v1/cms/media/${asset.id}/crop`, {
      data: { crop: { x: 0.1, y: 0.6, w: 0.3, h: 0.2 }, ratio: 390 / 252 },
      headers: apiHeaders(token),
    })

    // Через «неделю» открываем снова.
    const again = await request
      .get(`${API}/api/v1/cms/media/${asset.id}`, { headers: apiHeaders(token) })
      .then((r) => r.json())

    // Рамка та же — редактор откроется там, где человек её оставил.
    expect(again.crop).toEqual({ x: 0.1, y: 0.6, w: 0.3, h: 0.2 })
    expect(again.crop_ratio).toBeCloseTo(390 / 252, 4)
    // А ИСХОДНИК цел: адрес тот же, что и до обрезки.
    expect(again.original_url).toBe(asset.original_url)

    // И его можно взять ШИРЕ прежнего — значит отрезанное не потеряно.
    const wider = await request
      .put(`${API}/api/v1/cms/media/${asset.id}/crop`, {
        data: { crop: { x: 0, y: 0, w: 1, h: 1 }, ratio: 1 },
        headers: apiHeaders(token),
      })
      .then((r) => r.json())
    expect(wider.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  test('гость видит ровно то, что было в превью', async ({ request }) => {
    const token = await apiToken(request)
    const asset = await request
      .post(`${API}/api/v1/cms/media`, {
        multipart: {
          file: { name: 'tall.png', mimeType: 'image/png', buffer: tallPng() },
          kind: 'item',
        },
        headers: apiHeaders(token),
      })
      .then((r) => r.json())

    await request.put(`${API}/api/v1/cms/media/${asset.id}/crop`, {
      // Исходник 200×600. Чтобы кадр вышел ШИРЕ своей высоты, по высоте берём
      // меньше трети: 200×120 — это 1.67, форма карточки блюда.
      data: { crop: { x: 0, y: 0.1, w: 1, h: 0.2 }, ratio: 390 / 224 },
      headers: apiHeaders(token),
    })

    // Ждём нарезку: варианты режет воркер, и до его ответа гостю уходит старое.
    let ready: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await request
        .get(`${API}/api/v1/cms/media/${asset.id}`, { headers: apiHeaders(token) })
        .then((r) => r.json())
      if (current.status === 'ready') {
        ready = current
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    expect(ready, 'варианты так и не нарезались').toBeTruthy()

    // ГЛАВНОЕ: гостю уезжает УЖЕ ОБРЕЗАННЫЙ вариант, а не исходник, который
    // браузер обрежет по-своему. Значит форма кадра — та, что в превью.
    const cardUrl = String(ready!.url)
    expect(cardUrl).toBeTruthy()
    expect(cardUrl, 'гостю отдали исходник — кадр выберет браузер').not.toBe(
      ready!.original_url,
    )

    const delivered = await request.get(cardUrl)
    expect(delivered.ok(), `вариант не отдаётся: ${delivered.status()}`).toBeTruthy()
    const bytes = Buffer.from(await delivered.body())
    // Исходник вертикальный (200×600). Отданный вариант обязан быть ШИРЕ
    // своей высоты — иначе обрезка не применилась.
    const size = webpSize(bytes)
    expect(size, 'вариант не WebP').toBeTruthy()
    expect(
      size!.width / size!.height,
      `кадр не применился: отдали ${size!.width}×${size!.height} от вертикального 200×600`,
    ).toBeGreaterThan(1)
  })
})

/** Размер WebP из заголовка VP8/VP8L — ради теста не тащим декодер. */
function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  const format = buf.toString('ascii', 12, 16)
  if (format === 'VP8X') {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    }
  }
  if (format === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (format === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}
