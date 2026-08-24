import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { ADMIN, API, apiGet, apiHeaders, login, setPlanLevel } from './helpers'

/**
 * Раздел GRMS в CMS: путь администратора целиком.
 *
 * Импорт ПНР → конструктор → план → публикация → откат, плюс проверка на живой
 * комнате. Прогон идёт ПОДРЯД одним контекстом: шаги зависят друг от друга —
 * привязать зону плана можно только к опубликованному элементу, а откатиться
 * только на существующую версию.
 *
 * ПОЧЕМУ РАБОТАЕМ НА ИМПОРТИРОВАННОМ ТИПЕ, А НЕ НА ДЕМОНСТРАЦИОННОМ. Файл ПНР
 * создаёт ТИП1/ТИП2/ТИП3 — у них нет ни одного элемента интерфейса, то есть это
 * ровно то пустое состояние, с которого начинает администратор на объекте.
 * Демо-тип `demo-suite` собран сидом и на нём проверяется гость: собирать
 * поверх него значит менять то, что проверяет соседний файл.
 *
 * Комнаты демо-типа импорт не переклеивает: комната, уже отнесённая к другому
 * типу, попадает в конфликты, а не меняет хозяина молча. Поэтому импорт здесь
 * безопасен для гостевого прогона.
 */

/*
  КАДРЫ ПРОГОНА — ВО ВРЕМЕННЫЙ КАТАЛОГ, А НЕ В `docs/`.

  Раньше эта спека писала прямо в `docs/design/g6-shots`, и каждый полный
  прогон оставлял три изменённых PNG в рабочем дереве. Отличались они одним
  байтовым шумом — содержательно ничего не менялось, — но дерево после прогона
  переставало быть чистым, и их дважды откатывали руками.

  Съёмка для документации — отдельное действие, запускаемое ОСОЗНАННО: скрипты
  `shots-*.mjs` рядом делают ровно это. Здесь кадры нужны для разбора упавшего
  прогона, и место им там же, где отчёты Playwright.

  Положить их в `docs/` по-прежнему можно — переменной, а не молча:
      SHOTS_OUT=../docs/design/g6-shots npx playwright test tests/room-control-cms.spec.ts
*/
const SHOTS = path.resolve(
  __dirname,
  '..',
  process.env.SHOTS_OUT ?? 'test-results/g6-shots',
)

/** Тип из файла ПНР, на котором собирается экран. Меньше всего комнат. */
const TYPE_CODE = 'tip3'

const ZONE = 'e2e-zone'
const ELEMENT = 'e2e.light'

interface PlanGeometryPayload {
  zones: Array<{ controlId: string; mask: unknown }>
  [key: string]: unknown
}

interface GrmsType {
  code: string
  title: string
  rooms: string[]
  variables: Array<{ key: string; command: string; feedback: string; value_kind: string }>
}

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  page = await browser.newPage()
  await login(page, ADMIN)
})

test.afterAll(async () => {
  await page?.close()
})

async function openSection(): Promise<void> {
  await page.goto('/cms/room-control')
  await expect(page.getByTestId('cms-room-control')).toBeVisible({ timeout: 20_000 })
}

async function pickType(): Promise<void> {
  await openSection()
  await expect(page.getByTestId('grms-type-select')).toBeVisible()
  await openSelect('grms-type-select')
  // По значению, а не по названию: язык интерфейса CMS переключается, и
  // тест, завязанный на подпись, ломается о смену языка, а не о дефект.
  await page.locator(`li[data-value="${TYPE_CODE}"]`).click()
}

/**
 * Ввод в поле MUI: `data-testid` стоит на обёртке `TextField`, печатать надо в
 * сам `input`. Одной строкой здесь, чтобы не повторять это в каждом шаге.
 */
async function fillField(testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).locator('input').fill(value)
}

/**
 * Открыть выпадающий список MUI. Кликать по обёртке `TextField` нельзя: с
 * подсказкой под полем её центр приходится на текст подсказки, а не на само
 * поле, — и меню не открывается.
 */
async function openSelect(testId: string): Promise<void> {
  await page.getByTestId(testId).locator('[role="combobox"]').click()
}

async function openTab(key: string): Promise<void> {
  await page.getByTestId(`grms-tab-${key}`).click()
}

test('пункт раздела есть в навигации CMS — модуль подключён', async () => {
  await page.goto('/cms/dashboard')
  await expect(page.getByTestId('cms-nav-roomControl')).toBeVisible({ timeout: 20_000 })
})

test('проверка на живой комнате: только чтение ничего не переключает', async () => {
  test.setTimeout(120_000)
  await openSection()
  // Демо-тип: у него есть настоящая комната на эмуляторе. У импортированного
  // типа комнат в системе может не быть вовсе — проверять было бы негде.
  await openSelect('grms-type-select')
  await page.locator('li[data-value="demo-suite"]').click()
  await openTab('check')

  // Раньше здесь стоял `test.skip`: нет элементов — тест выключал сам себя.
  // Это худший исход из возможных: на пустом типе он показывал «skipped», то
  // есть отсутствие проверки выглядело как её отсутствие по уважительной
  // причине. Пустой демо-тип — это поломка стенда, и узнавать о ней надо
  // падением.
  await expect(
    page.getByTestId('grms-check-nothing'),
    'у демо-типа нет связанных элементов — проверять на живой комнате нечего',
  ).toHaveCount(0)

  await openSelect('grms-check-element')
  await page.locator('li[role="option"]').first().click()
  await page.getByTestId('grms-check-read').click()
  await expect(page.getByTestId('grms-check-result')).toBeVisible({ timeout: 60_000 })
})

test('доступ: демо-вход показан вместе с предупреждением сервера', async () => {
  await openSection()
  await openTab('access')
  await expect(page.getByTestId('grms-access')).toBeVisible({ timeout: 20_000 })
  // Формулировка послабления приезжает с сервера — на неё и смотрим.
  await expect(page.getByTestId('grms-demo-warning')).toContainText('ОСЛАБЛЯЕТ')
  await page.screenshot({ path: path.join(SHOTS, 'access.png'), fullPage: true })
})

test('доступ: включённый демо-вход гасит таблицу PIN и говорит почему', async () => {
  await openSection()
  await openTab('access')
  await expect(page.getByTestId('grms-access')).toBeVisible({ timeout: 20_000 })

  // Порядок секций: PIN — штатное поведение, поэтому сверху. Демо-вход —
  // послабление на время показа, поэтому ниже и отдельной карточкой.
  const order = await page.locator('[data-testid="grms-access"] .MuiCard-root').count()
  expect(order).toBeGreaterThanOrEqual(2)
  const demoBox = await page.getByTestId('grms-demo-section').boundingBox()
  const pinSave = await page.getByTestId('grms-pin-save').boundingBox()
  expect(demoBox!.y).toBeGreaterThan(pinSave!.y)

  // Флаг отельный, а не комнатный — слово «отель» стоит в заголовке секции.
  await expect(page.getByTestId('grms-demo-section')).toContainText('отел')

  const toggle = page.getByTestId('grms-demo-entry').locator('input')
  const wasOn = await toggle.isChecked()
  if (!wasOn) await toggle.click()

  // УКУС. При включённом послаблении PIN не спрашивают ни у кого: таблица
  // обязана погаснуть и сказать причину, а не молча показывать «активен».
  await expect(page.getByTestId('grms-pin-muted')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('grms-pin-muted')).toContainText('демо-вход')
  // Заводить код при этом по-прежнему можно — к показу готовятся заранее.
  await expect(page.getByTestId('grms-pin-save')).toBeVisible()
  // Кто и когда включил — из журнала, прямо здесь.
  await expect(page.getByTestId('grms-demo-toggled')).toContainText('Включил')

  await page.screenshot({ path: path.join(SHOTS, 'access-demo-on.png'), fullPage: true })

  if (!wasOn) {
    await toggle.click()
    await expect(page.getByTestId('grms-pin-muted')).toHaveCount(0)
  }
})

/** Фигуры зон на сцене. У форм инспектора префикс свой (`grms-plan-form-`). */
async function zoneCount(): Promise<number> {
  return page.locator('[data-testid^="grms-plan-zone-"]').count()
}

/**
 * Жест разметки — обеими точками ВНУТРИ ОКНА.
 *
 * `page.mouse` бьёт по координате окна и страницу не прокручивает. Сцена
 * высокая: при окне 900 её низ уходит за край, и точка «55% высоты» оказалась
 * на 1131-м пикселе — `pointerdown` не попадал на сцену вовсе, зона не
 * создавалась, а тест винил редактор. Проверено: тем же жестом внутри окна
 * зона создаётся.
 *
 * Порядок здесь не косметический. Сначала клик по инструменту: Playwright сам
 * прокручивает кнопку в видимую часть и этим двигает сцену — координаты,
 * снятые до клика, протухают. `boundingBox` берётся ПОСЛЕ.
 */
async function drawZone(stage: Locator): Promise<void> {
  await page.getByTestId('grms-plan-tool-zone').click()
  await stage.scrollIntoViewIfNeeded()
  const box = (await stage.boundingBox())!
  const view = page.viewportSize()!

  // Полоса сцены, видимая прямо сейчас. Отступ в 60 пикселей — чтобы жест не
  // цеплял край и не начинался на границе с соседним элементом.
  const top = Math.max(box.y, 0) + 60
  const bottom = Math.min(box.y + box.height, view.height) - 60
  if (bottom - top < 120) {
    throw new Error(
      `Видимая часть сцены ${Math.round(bottom - top)}px — рисовать негде. ` +
        `Сцена y=${Math.round(box.y)} h=${Math.round(box.height)}, окно ${view.height}.`,
    )
  }

  const x1 = box.x + box.width * 0.3
  const x2 = box.x + box.width * 0.5
  const y2 = Math.min(top + 200, bottom)

  await page.mouse.move(x1, top)
  await page.mouse.down()
  await page.mouse.move(x2, y2, { steps: 8 })
  await page.mouse.up()
}

interface VersionRow {
  version: number
  is_current: boolean
  rolled_back_from: number | null
}

async function versionList(
  request: APIRequestContext,
  token: string,
): Promise<VersionRow[]> {
  const { versions } = await apiGet<{ versions: VersionRow[] }>(
    request,
    token,
    `/api/cms/grms/types/${TYPE_CODE}/versions`,
  )
  return versions
}

async function versionNumbers(request: APIRequestContext, token: string): Promise<number[]> {
  return (await versionList(request, token)).map((v) => v.version)
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/staff/auth/login`, {
    data: ADMIN,
    headers: { 'X-Hotel-Subdomain': 'crystal' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).access
}

/**
 * СВЯЗЬ ДВУХ ЭКРАНОВ (пункт 3).
 *
 * Пользователь спрашивал, почему управление номером живёт отдельно от
 * номерного фонда. Раздел остаётся своим — переносить конфигурацию ТИПА внутрь
 * списка НОМЕРОВ значило бы дублировать её в каждой строке, — но перестаёт
 * быть островом: из номера видно, чем он управляется, и наоборот.
 */
test.describe('Связь номерного фонда и управления номером', () => {
  test('УКУС: в списке номеров есть тип управления и он ведёт в конфигурацию', async () => {
    await page.goto('/cms/rooms')
    await expect(page.getByTestId('room-row-305')).toBeVisible({ timeout: 20_000 })

    const cell = page.getByTestId('room-control-type-305')
    await expect(cell).toBeVisible()
    /*
      Код берём СО СТРАНИЦЫ, а не подставляем свой: демо-номер привязан к
      сидовому типу, а импортированный тестом — к своим комнатам. Тест не
      должен знать, какой именно, — он проверяет, что колонка называет тип и
      что ссылка ведёт в ЭТОТ ЖЕ тип.
    */
    const shown = (await cell.innerText()).trim()
    expect(shown, 'номер 305 показан без типа управления').not.toBe('—')

    await cell.click()
    // Открылась конфигурация ИМЕННО того типа, что назван в строке, а не
    // первого попавшегося: иначе переход отвечает не на тот вопрос, ради
    // которого по нему пошли.
    await expect(page.getByTestId('cms-room-control')).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(new RegExp(`type=${encodeURIComponent(shown)}`))
    await expect(page.getByTestId('grms-type-select')).toContainText(/./)
  })

  test('обратно: шапка управления говорит, сколько номеров на типе', async () => {
    /*
      Тип берём ТОТ, У КОТОРОГО КОМНАТЫ ТОЧНО ЕСТЬ — прочитанный из списка
      номеров. Импортированный тестом тип бывает без привязок (их создаёт
      только подтверждение ПНР), и тест, завязанный на него, падал бы не о
      дефект, а о порядок соседних прогонов.
    */
    await page.goto('/cms/rooms')
    await expect(page.getByTestId('room-row-305')).toBeVisible({ timeout: 20_000 })
    const bound = (await page.getByTestId('room-control-type-305').innerText()).trim()
    expect(bound, 'номер 305 без типа — проверять нечего').not.toBe('—')

    await page.goto(`/cms/room-control?type=${encodeURIComponent(bound)}`)
    await expect(page.getByTestId('cms-room-control')).toBeVisible({ timeout: 20_000 })

    const chip = page.getByTestId('grms-type-rooms')
    await expect(chip).toBeVisible()
    // Цена ошибки в конфигурации — ровно это число номеров.
    await expect(chip).toContainText(/\d+/)

    await chip.click()
    await expect(page).toHaveURL(/\/cms\/rooms/)
  })
})
