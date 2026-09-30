import { deflateSync } from 'node:zlib'

/**
 * PNG БЕЗ БИБЛИОТЕК — ДЛЯ ПРОВЕРОК ПРОЗРАЧНОСТИ (партия 25).
 *
 * Холст браузера хранит цвет premultiplied: прозрачный белый (255,255,255,0)
 * он сохраняет как прозрачный чёрный, и проверка «угол прозрачен» перестаёт
 * отличать «альфа сохранилась» от «альфу выбросили и осталась подложка».
 * Поэтому файл собирается здесь, байт в байт.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA-картинка по функции пикселя. */
export function pngRGBA(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // бит на канал
  header[9] = 6 // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0 // без фильтра
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
