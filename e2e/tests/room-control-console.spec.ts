import { type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { ADMIN, API, apiGet, apiHeaders, apiToken, HOTEL, PLATFORM, setPlanLevel, waitForLayout } from './helpers'

/**
 * КОНФИГУРАЦИЯ УПРАВЛЕНИЯ НОМЕРОМ — В NAVIROOM CONTROL.
 *
 * Эти проверки жили в наборе CMS отеля, потому что и раздел жил там. Услуга
 * платная и оказываем её мы: импорт ПНР, конструктор, план и публикация
 * переехали в консоль, и проверки переехали за ними — тест обязан ходить тем
 * же путём, что и человек.
 *
 * Отель выбирается КАРТОЧКОЙ: в консоли «текущего отеля» нет, и все запросы
 * адресуют его id.
 */

const SHOTS = path.resolve(__dirname, '..', process.env.SHOTS_OUT ?? 'test-results/g6-shots')
const PNR = path.resolve(__dirname, '../../backend/tests/fixtures/pnr-variables.xlsx')
const RENDER = path.resolve(__dirname, '../../docs/design/grms-concept/render-type1.png')

/** Тип из файла ПНР, на котором собирается экран. Меньше всего комнат. */
const TYPE_CODE = 'tip3'
/*
  С партии 63-4 коды зоны и кнопки выдаёт сервер (из названия и вида), а не
  вводит оператор: «Комната прогона» → зона `komnata-progona`, свет в ней —
  кнопка `light.komnata-progona`.
*/
const ZONE_TITLE = 'Комната прогона'
const ZONE = 'komnata-progona'
const ELEMENT = `light.${ZONE}`
const mark = Date.now().toString(36)

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
/** id отеля в консоли: адресуется им, а не поддоменом. */
let hotelId = ''

test.beforeAll(async ({ browser, request }) => {
  mkdirSync(SHOTS, { recursive: true })
  page = await browser.newPage()

  await page.goto('/admin')
  // Чистим хранилище: сессия CMS из соседнего набора иначе доживает до входа
  // в консоль и путает, чьим токеном идёт запрос.
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })

  const login = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  const token = (await login.json()).access
  const hotels = await request.get(`${API}/api/v1/platform/hotels?limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  hotelId = (await hotels.json()).items.find(
    (row: { subdomain: string }) => row.subdomain === HOTEL,
  ).id
})

test.afterAll(async () => {
  await page?.close()
})

/**
 * Открыть выпадающий список — в двух разных разметках.
 *
 * На этом экране их две, и это следствие переиспользования: селект типа —
 * собственный контрол консоли, метка на видимой части; селекты внутри
 * переехавших экранов пришли из CMS, где метка стоит на ОБЁРТКЕ `TextField`, а
 * кликать надо по комбобоксу внутри.
 *
 * Поэтому спрашиваем разметку, а не предполагаем её: один вариант молча не
 * открывал меню, и тест падал на ожидании пункта, которого не показали.
 */
async function openSelect(testId: string): Promise<void> {
  // testid стоит на самом поле выбора (role=combobox, партия 54).
  await page.getByTestId(testId).click()
}

/** Открыть карточку отеля на вкладке управления номером. */
async function openSection(): Promise<void> {
  /*
    Раздел консоли держится в СОСТОЯНИИ, а не в маршруте, и карточка отеля
    показывается только внутри «Отелей». Поэтому в адресе обязателен и
    `section=fleet` — без него открывается сводка платформы, и тест ждёт
    вкладку, которой на экране нет.
  */
  await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=roomControl`)
  await expect(page.getByTestId('admin-hotel-room-control')).toBeVisible({ timeout: 20_000 })
}

/**
 * Шаг варианта (партия 63-4): прежние подвкладки стали шагами внутри
 * варианта, и вариант с шагом — в адресе.
 */
async function openStep(step: 'base' | 'plan' | 'buttons' | 'rooms' | 'check' | 'publish'): Promise<void> {
  await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=roomControl&variant=${TYPE_CODE}&step=${step}`)
  await expect(page.getByTestId(`admin-variant-pane-${step}`)).toBeVisible({ timeout: 20_000 })
}

/** Разметка плана — редактор внутри шага «План», за кнопкой «Кадр и разметка». */
async function openPlanEditor(): Promise<void> {
  await openStep('plan')
  await page.getByTestId('admin-variant-markup-open').click()
  await expect(page.getByTestId('grms-plan-editor')).toBeVisible({ timeout: 20_000 })
}

/**
 * Изменить название кнопки прогона — чтобы черновик отличался от текущей
 * версии: публиковать без изменений экран не даёт, и это правильно.
 */
async function touchButton(): Promise<void> {
  await openStep('buttons')
  await page.getByTestId(`admin-variant-button-open-${ELEMENT}`).click()
  const dialog = page.getByTestId('admin-variant-button-dialog')
  await dialog.getByTestId('admin-variant-button-title-ru').fill(`Свет прогона ${mark}-${Math.random().toString(36).slice(2, 6)}`)
  await dialog.getByTestId('admin-variant-button-save').click()
  await expect(dialog.getByTestId('admin-variant-button-save')).toHaveCount(0, { timeout: 15_000 })
  await dialog.getByTestId('admin-variant-button-done').click()
}

/** Опубликовать через подтверждение «изменится у N номеров». */
async function publishNow(): Promise<void> {
  await openStep('publish')
  await page.getByTestId('admin-variant-publish').click()
  await page.getByTestId('admin-variant-publish-go').click()
}

/**
 * Токен КОНСОЛИ, а не отеля.
 *
 * Конфигурация переехала к нам, и проверять её токеном администратора отеля
 * значило бы проверять не тот путь: под ним эти ручки отвечают 401, и именно
 * это отдельный укус и утверждает.
 */
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
    grmsPath(`/types/${TYPE_CODE}/versions`),
  )
  return versions
}

async function versionNumbers(request: APIRequestContext, token: string): Promise<number[]> {
  return (await versionList(request, token)).map((v) => v.version)
}

async function consoleToken(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(login.ok(), await login.text()).toBeTruthy()
  return (await login.json()).access
}

/** Путь платформенной ручки конфигурации этого отеля. */
function grmsPath(tail: string): string {
  return `/api/v1/platform/hotels/${hotelId}/grms${tail}`
}

/** Заголовки консоли: поддомен отеля здесь не нужен — отель назван в адресе. */
function consoleHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

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


test('импорт ПНР: разбор, сверка и сохранение', async ({ request }) => {
  test.setTimeout(120_000)
  await openSection()
  // С 63-4 импорт — «Новый вариант» → «Из файла пусконаладки».
  await page.getByTestId('admin-variant-new-open').click()
  await page.getByTestId('admin-variant-new-mode-file').click()

  await page.getByTestId('grms-import-file').setInputFiles(PNR)
  await page.getByTestId('grms-import-preview').click()

  const result = page.getByTestId('grms-import-result')
  await expect(result).toBeVisible({ timeout: 30_000 })
  // В присланном файле три типа — число здесь настоящее, а не «больше нуля».
  await expect(page.getByTestId('grms-import-types-count')).toContainText('3')

  // Сверка с живым оборудованием НЕ блокирует сохранение: коннектор на стенде
  // может быть офлайн, и это состояние объекта, а не ошибка импорта.
  await page.getByTestId('grms-import-reconcile').click()
  await expect(page.getByTestId('grms-reconcile')).toBeVisible({ timeout: 60_000 })

  /*
    ТРИ РАЗНЫЕ ПРОВЕРКИ, А НЕ ОДНА.

    Здесь стояло ожидание селектора типов — он рисуется при
    `list.length > 0` и потому виден ДО импорта: `demo-suite` есть всегда.
    Ожидание проходило мгновенно, ничего не дожидаясь, и следом тест шёл в API
    ОТДЕЛЬНЫМ подключением. Между кликом и вопросом не было ни одной точки
    синхронизации: обычно подтверждение успевало первым, на загруженной машине —
    нет. Отсюда флак, три красных прогона из шести.

    Подписка ставится ДО клика: быстрый ответ иначе можно пропустить.
  */
  const saved = page.waitForResponse((response) =>
    response.url().includes('/grms/import/confirm'),
  )
  await page.getByTestId('grms-import-confirm').click()
  const confirmed = await saved
  // Отказ подтверждения тест раньше не замечал вовсе и падал позже, на
  // следствии — «нет типа» вместо «сервер не принял импорт».
  expect(confirmed.ok(), `подтверждение импорта отклонено: ${confirmed.status()}`).toBeTruthy()

  // Второе: вариант виден ОПЕРАТОРУ карточкой в списке. Ради этого экран и делали.
  await expect(page.getByTestId(`admin-variant-${TYPE_CODE}`)).toBeVisible({ timeout: 20_000 })

  // Третье: результат на бэкенде — «видно на экране» и «записалось» разные
  // утверждения, и подменять одно другим нельзя.
  const token = await consoleToken(request)
  const { types } = await apiGet<{ types: GrmsType[] }>(request, token, grmsPath('/types'))
  const imported = types.find((type) => type!.code === TYPE_CODE)
  expect(imported, 'импортированный тип').toBeTruthy()
  expect(imported!.variables.length).toBeGreaterThan(0)
})

test('кнопки: зона, кнопка, связь с каналом — и кнопка готова для гостя', async ({ request }) => {
  test.setTimeout(120_000)
  const token = await consoleToken(request)
  const { types } = await apiGet<{ types: GrmsType[] }>(request, token, grmsPath('/types'))
  // Называем, ЧТО пришло: искать приходится причину — какой список отдал сервер.
  expect(
    types.find((t) => t.code === TYPE_CODE),
    `тип ${TYPE_CODE} не найден; пришли: ${types.map((t) => t.code).join(', ') || '(пусто)'}`,
  ).toBeTruthy()

  // Зона — в шаге «План» (63-4). Стенд живёт между прогонами: есть — не дублируем.
  await openStep('plan')
  if (!(await page.getByTestId(`admin-variant-zone-row-${ZONE}`).isVisible().catch(() => false))) {
    await page.getByTestId('admin-variant-zone-add').click()
    await page.getByTestId('admin-variant-zone-new-ru').fill(ZONE_TITLE)
    await page.getByTestId('admin-variant-zone-add-save').click()
    await expect(page.getByTestId(`admin-variant-zone-row-${ZONE}`)).toBeVisible({ timeout: 20_000 })
  }

  await openStep('buttons')
  const element = page.getByTestId(`admin-variant-button-${ELEMENT}`)
  if (!(await element.isVisible().catch(() => false))) {
    // Именно свет: у него обязательная возможность «вкл/выкл», под которую в
    // файле ПНР заведомо есть двоичный канал.
    await page.getByTestId('admin-variant-button-add').click()
    const add = page.getByTestId('admin-variant-button-add-dialog')
    await add.getByTestId('admin-variant-kind-light_group').click()
    await openSelect('admin-variant-button-zone')
    await page.locator(`li[data-value="${ZONE}"]`).click()
    await add.getByTestId('admin-variant-button-title-ru').fill('Свет прогона')
    await add.getByTestId('admin-variant-button-add-save').click()
    await page.getByTestId('admin-variant-button-done').click()
    // Пока связи нет — кнопка честно говорит, что гость её не увидит.
    await expect(element).toHaveAttribute('data-ready', 'false', { timeout: 20_000 })
  }

  // Связь могла остаться с прошлого раза: повторять её — проверять дубль.
  if ((await element.getAttribute('data-ready')) !== 'true') {
    await page.getByTestId(`admin-variant-button-open-${ELEMENT}`).click()
    await page.getByTestId('admin-variant-pick-toggle').click()
    // Первый подходящий канал: подходящие стоят сверху.
    await page.getByTestId('admin-variant-channel-picker').locator('[data-fit="good"], [data-fit="ok"]').first().click()
    await expect(page.getByTestId('admin-variant-ability-toggle')).toHaveAttribute('data-linked', 'true', { timeout: 20_000 })
    await page.getByTestId('admin-variant-button-done').click()
  }

  await expect(element).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
})

test('публикация: элемент уезжает в снимок версией', async ({ request }) => {
  test.setTimeout(120_000)
  const token = await consoleToken(request)
  // Стенд живёт между прогонами, поэтому считаем ОТ ТЕКУЩЕГО состояния, а не
  // от «версии №1»: на втором прогоне её давно перекрыли.
  const before = await versionNumbers(request, token)

  await touchButton()
  await publishNow()

  const expected = Math.max(0, ...before) + 1
  await expect(page.getByTestId(`admin-variant-version-${expected}`)).toBeVisible({ timeout: 30_000 })

  const after = await versionList(request, token)
  expect(after.find((v) => v.is_current)?.version).toBe(expected)
})

test('план: кадр, разметка мышью, привязка к опубликованному элементу и сохранение', async ({
  request,
}) => {
  // Кадр реально уезжает в медиапайплайн, а ночной считается фоном — это
  // секунды, а не миллисекунды.
  test.setTimeout(180_000)

  /*
    СНАЧАЛА УРОВЕНЬ, ПОТОМ ПЛАН — это и есть настоящий порядок работы.

    Свежеимпортированный тип начинается с плашек: у него нет ни кадра, ни
    купленного уровня, и редактор плана до этого шага закрыт намеренно.
    Поднимаем уровень учёткой ПЛАТФОРМЫ: отелю это действие не подчинено, и
    его токен получит здесь 403.
  */
  await setPlanLevel(request, TYPE_CODE, 'full')

  await openPlanEditor()

  const stage = page.getByTestId('grms-plan-stage')
  if (!(await stage.isVisible().catch(() => false))) {
    await expect(page.getByTestId('grms-plan-no-frame')).toBeVisible()
    await page.getByTestId('grms-plan-lit-input').setInputFiles(RENDER)
    await page.getByTestId('grms-plan-upload').click()
    await expect(stage).toBeVisible({ timeout: 120_000 })
  }

  // Стенд живёт между прогонами, и каждый добавляет по зоне. Подрезаем, чтобы
  // разметка не росла бесконечно от прогона к прогону.
  const token = await consoleToken(request)
  if ((await zoneCount()) > 2) {
    const current = await apiGet<{ geometry: PlanGeometryPayload }>(
      request,
      token,
      grmsPath(`/types/${TYPE_CODE}/plan`),
    )
    const trimmed = { ...current.geometry, zones: current.geometry.zones.slice(0, 1) }
    await request.put(`${API}${grmsPath(`/types/${TYPE_CODE}/plan`)}`, {
      data: trimmed,
      headers: consoleHeaders(token),
    })
    // Вариант — в адресе: разметка не уедет в чужой план.
    await openPlanEditor()
    await expect(page.getByTestId('grms-plan-stage')).toBeVisible({ timeout: 60_000 })
  }

  // Рисуем зону мышью — ровно тем же жестом, что и администратор.
  const before = await zoneCount()
  await drawZone(stage)
  // Ожидание с повтором, а не мгновенный подсчёт: пока считается ночной кадр,
  // план перезапрашивается каждые три секунды, и перерисовка может встать
  // ровно между «отпустил» и проверкой.
  await expect(page.locator('[data-testid^="grms-plan-zone-"]')).toHaveCount(before + 1, {
    timeout: 15_000,
  })

  // Привязка — ВЫБОР ИЗ СПИСКА опубликованных элементов, а не ввод controlId.
  await expect(page.getByTestId('grms-plan-form-zone')).toBeVisible()
  await openSelect('grms-plan-form-control')
  await page.locator(`li[data-value="${ELEMENT}"]`).click()

  await page.getByTestId('grms-plan-save').click()
  // Ждём ИМЕННО «сохранено», а не погасшую кнопку: кнопка гаснет и на время
  // самого запроса, и раньше проверка спрашивала сервер, пока PUT ещё летел —
  // на нагруженном стенде получала план без зоны и обвиняла в этом редактор.
  await expect(page.getByTestId('toast')).toContainText('Разметка сохранена', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('grms-plan-save')).toBeDisabled()

  const plan = await apiGet<{ geometry: PlanGeometryPayload }>(
    request,
    token,
    grmsPath(`/types/${TYPE_CODE}/plan`),
  )
  expect(plan.geometry.zones.length).toBe(before + 1)
  // Маска считается из зоны на сохранении, а не рисуется отдельно.
  expect(plan.geometry.zones.every((zone) => zone.mask)).toBeTruthy()
  expect(plan.geometry.zones.some((zone) => zone.controlId)).toBeTruthy()

  await page.screenshot({ path: path.join(SHOTS, 'plan-editor-dark.png'), fullPage: true })
  await page.getByTestId('theme-toggle').click()
  await waitForLayout(page)
  await page.screenshot({ path: path.join(SHOTS, 'plan-editor-light.png'), fullPage: true })
  await page.getByTestId('theme-toggle').click()
})

test('предпросмотр плана: клик по зоне переключает свет', async () => {
  await openPlanEditor()
  await expect(page.getByTestId('grms-plan-stage')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('grms-plan-preview').click()
  // Последняя из нарисованных: зоны могут перекрываться, и верхняя из них —
  // та, по которой попадёт палец администратора.
  const zone = page.locator('[data-testid^="grms-plan-zone-"]').last()
  await expect(zone).toHaveAttribute('data-lit', 'false')
  await zone.click()
  await expect(zone).toHaveAttribute('data-lit', 'true')
})

test('план блокирует публикацию, если ссылается на снятый элемент', async ({ request }) => {
  // Сторож живёт на бэкенде и проверен там же; здесь — что администратор
  // ВИДИТ отказ, а не молчаливо публикует битую разметку.
  const token = await consoleToken(request)
  const plan = await apiGet<{ geometry: Record<string, unknown> }>(
    request,
    token,
    grmsPath(`/types/${TYPE_CODE}/plan`),
  )
  const broken = {
    ...plan.geometry,
    zones: [
      ...(plan.geometry.zones as Array<Record<string, unknown>>),
      {
        code: 'e2e-dangling',
        controlId: 'нет.такого.элемента',
        hit: { x: 5, y: 5, w: 10, h: 10 },
        mask: { x: 1, y: 1, w: 18, h: 18 },
      },
    ],
  }
  const saved = await request.put(`${API}${grmsPath(`/types/${TYPE_CODE}/plan`)}`, {
    data: broken,
    headers: consoleHeaders(token),
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()

  await touchButton()
  await publishNow()
  // С 63-4 отказ — словами и названием зоны, до обращения к публикации.
  await expect(page.getByTestId('admin-variant-error')).toContainText('На плане зона без кнопки', { timeout: 20_000 })

  // Убираем битую ссылку: следующий шаг прогона должен публиковаться.
  const fixed = await request.put(`${API}${grmsPath(`/types/${TYPE_CODE}/plan`)}`, {
    data: plan.geometry,
    headers: consoleHeaders(token),
  })
  expect(fixed.ok()).toBeTruthy()
})

test('откат возвращает предыдущую версию', async ({ request }) => {
  test.setTimeout(120_000)
  const token = await consoleToken(request)
  const before = await versionNumbers(request, token)
  // Прежняя текущая: после новой публикации она в первых строках истории.
  const target = Math.max(...before)

  await touchButton()
  await publishNow()

  const published = Math.max(...before) + 1
  await expect(page.getByTestId(`admin-variant-version-${published}`)).toBeVisible({ timeout: 30_000 })

  // Откат — это НОВАЯ версия с телом старой, а не переписанная история; и
  // только через подтверждение.
  await page.getByTestId(`admin-variant-rollback-${target}`).click()
  await page.getByTestId('admin-variant-rollback-go').click()
  await expect(page.getByTestId(`admin-variant-version-${published + 1}`)).toBeVisible({ timeout: 30_000 })

  const after = await versionList(request, token)
  const current = after.find((v) => v.is_current)!
  expect(current.rolled_back_from).toBe(target)
})

test('УКУС: инженерная диагностика показывает разбор обмена, которого нет у отеля', async () => {
  // С 63-4 журнал оборудования — во вкладке «Журнал» карточки.
  await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=journal`)
  await expect(page.getByTestId('grms-diagnostics')).toBeVisible({ timeout: 20_000 })

  // Обратная сторона отельского укуса в `room-control-cms.spec`: та же вкладка,
  // тот же код, но глубина инженерная — и плашки «журнал урезан» здесь быть не
  // должно, иначе экран врёт про собственную выдачу.
  await expect(page.getByTestId('diagnostics-depth-hotel')).toHaveCount(0)
})
