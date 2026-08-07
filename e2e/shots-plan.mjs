/**
 * Съёмка плана номера на КАДРИРОВАННОМ рендере — руками, а не прогоном.
 *
 * Прогон в `docs/` не пишет (см. `tests/room-control-cms.spec.ts`): кадры для
 * документации снимает этот скрипт, запущенный осознанно.
 *
 * Снимается то, что изменилось вместе с рендером: пропорция плиты, потолок её
 * высоты на телефоне (кадр обрезается снизу, разметка остаётся на месте) и
 * метки света, замеренные по новому кадру.
 *
 * Телефон снимается на 664 px видимой высоты, а не на 844: это iPhone 12 в
 * Safari, где над страницей стоит строка браузера. Именно на нём плита упирается
 * в потолок — на полной высоте экрана потолок не достаётся, и кадр цел.
 *
 * Свет включается и выключается ТЕМ ЖЕ путём, что у гостя, — нажатием на
 * экране. Класть состояние в базу мимо интерфейса значило бы снять кадр,
 * которого гость не увидит.
 *
 *     node shots-plan.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/plan-cropped'
const ROOM = process.env.ROOM ?? '305'

const ZONES = ['living', 'bedroom', 'entry', 'wardrobe', 'bathroom']

const DEVICES = [
  // Плотность пикселей разная не по недосмотру: телефон снимается «в ретину»,
  // потому что на нём разбирают детали плана, а десктопный кадр 1440×900 и так
  // крупный — вторая плотность раздувала бы репозиторий вчетверо ни за чем.
  { name: 'phone', viewport: { width: 390, height: 664 }, scale: 2, desktop: false },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, scale: 1, desktop: true },
]

mkdirSync(path.resolve(OUT), { recursive: true })

/** Состояние меток света на плане — то же, что видит гость. */
const litCount = (page) =>
  page.evaluate((zones) =>
    zones.filter(
      (zone) =>
        document
          .querySelector(`[data-testid="room-plan-marker-light.${zone}"]`)
          ?.getAttribute('data-on') === 'true',
    ).length, ZONES)

async function waitLit(page, expected, timeout = 40000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if ((await litCount(page)) === expected) return true
    await page.waitForTimeout(500)
  }
  console.warn(`  ! свет не сошёлся: ждали ${expected}, на плане ${await litCount(page)}`)
  return false
}

const browser = await chromium.launch()

for (const device of DEVICES) {
  for (const mode of ['dark', 'light']) {
    const tag = `${device.name}-${mode}`
    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      locale: 'ru-RU',
      hasTouch: !device.desktop,
    })
    const page = await context.newPage()

    await page.goto(BASE)
    await page.evaluate((m) => {
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem('itv.theme-mode', m)
    }, mode)
    await page.goto(BASE)
    await page.getByTestId('guest-room-input').fill(ROOM)
    await page.getByTestId('guest-room-submit').click()
    await page.getByTestId('guest-nav-room').waitFor({ timeout: 25000 })
    await page.getByTestId('guest-nav-room').click()
    await page.getByTestId('room-plan').waitFor({ timeout: 25000 })
    await page.waitForTimeout(2500)

    const plate = page.getByTestId('room-plan')
    /**
     * Нажатие по строке списка — с прокруткой к середине экрана.
     *
     * На телефоне нижние строки лежат под плавающей навигацией, и клик уходит
     * ей. Это не поломка раскладки: список длиннее экрана и прокручивается, —
     * но снимающему скрипту нужно попасть по строке, а не по навигации.
     */
    const tapRow = async (testId) => {
      const row = page.getByTestId(testId)
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(250)
      try {
        await row.click({ timeout: 5000 })
      } catch {
        // Список кончился и прокрутить строку выше навигации некуда. Для
        // СЪЁМКИ это не помеха: нажимаем тем же обработчиком, что и палец.
        console.warn(`  ! ${testId}: строка под навигацией, жмём напрямую`)
        await row.evaluate((el) => el.click())
      }
    }
    const shot = async (state) => {
      // Кадр снимается ОТ ВЕРХА страницы: ниже плита ужимается прокруткой, и
      // на снимке оказался бы не план, а его уменьшенная копия.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(1200)
      await page.screenshot({ path: path.join(OUT, `${tag}-${state}.png`), animations: 'disabled' })
      // Отдельный кадр плиты — только с телефона: там она обрезана, и разбирать
      // приходится именно её. На десктопе плита цела и целиком видна на общем
      // кадре, второй файл был бы тем же самым, только тяжелее.
      if (!device.desktop) await plate.screenshot({ path: path.join(OUT, `plate-${tag}-${state}.png`) })
    }

    // Свет выключен: горит ночной кадр, светлых окон на нём нет. Кнопка
    // «погасить всё» гаснет сама, когда гасить уже нечего, — на втором заходе
    // номер приходит с прошлой съёмки уже тёмным.
    const allOff = page.getByTestId('room-all-lights-off')
    if (await allOff.isEnabled()) {
      await tapRow('room-all-lights-off')
      await waitLit(page, 0)
    }
    await waitLit(page, 0)
    await shot('lights-off')

    // Свет включён во всех зонах: светлый кадр показан по каждой из них.
    for (const zone of ZONES) {
      await tapRow(`room-control-light.${zone}`)
      await page.waitForTimeout(700)
    }
    await waitLit(page, ZONES.length)
    await shot('lights-on')

    /*
      Поток воздуха. Кондиционер включается на вкладке климата (на десктопе
      панель и так на виду), скорость — максимальная из доступных: густота
      струи и есть скорость вентилятора.
    */
    if (!device.desktop) await page.getByTestId('room-tabs-climate').click()
    const power = page.getByTestId('room-control-ac.1')
    await power.waitFor({ timeout: 15000 })
    if ((await power.getAttribute('aria-pressed')) !== 'true') {
      await tapRow('room-control-ac.1')
      await page.waitForTimeout(6000)
    }
    const speeds = page.locator('[data-testid^="room-fan-ac.1-"]')
    if (await speeds.count()) {
      const fastest = await speeds.last().getAttribute('data-testid')
      await tapRow(fastest)
      await page.waitForTimeout(6000)
    }
    await shot('airflow')

    console.log(
      tag,
      'снято; зон горит:',
      await litCount(page),
      'поток:',
      await page.getByTestId('room-plan-airflow').getAttribute('data-flow'),
    )
    await context.close()
  }
}

await browser.close()
