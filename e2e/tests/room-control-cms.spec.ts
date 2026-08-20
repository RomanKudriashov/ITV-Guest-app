import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { ADMIN, API, apiGet, apiHeaders, login } from './helpers'

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
const PNR = path.resolve(__dirname, '../../backend/tests/fixtures/pnr-variables.xlsx')
const RENDER = path.resolve(__dirname, '../../docs/design/grms-concept/render-type1.png')

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

test('импорт ПНР: разбор, сверка и сохранение', async ({ request }) => {
  test.setTimeout(120_000)
  await openSection()
  await openTab('import')

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

    Здесь стояло ожидание `grms-type-select` — селектора, который рисуется при
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

  // Второе: тип виден АДМИНИСТРАТОРУ в списке. Ради этого экран и делали.
  await openSelect('grms-type-select')
  await expect(page.locator(`li[data-value="${TYPE_CODE}"]`)).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')

  // Третье: результат на бэкенде — «видно на экране» и «записалось» разные
  // утверждения, и подменять одно другим нельзя.
  const token = await adminToken(request)
  const { types } = await apiGet<{ types: GrmsType[] }>(request, token, '/api/cms/grms/types')
  const imported = types.find((type) => type.code === TYPE_CODE)
  expect(imported, 'импортированный тип').toBeTruthy()
  expect(imported!.variables.length).toBeGreaterThan(0)
})

test('конструктор: зона, элемент, привязка — и элемент перестаёт быть скрытым', async ({
  request,
}) => {
  test.setTimeout(120_000)
  const token = await adminToken(request)
  const { types } = await apiGet<{ types: GrmsType[] }>(request, token, '/api/cms/grms/types')
  const type = types.find((t) => t.code === TYPE_CODE)!
  // Переменная под свет: двоичная, с командой И обратной связью — иначе
  // привязка законно не пройдёт валидацию.
  const variable = type.variables.find(
    (v) => v.value_kind === 'binary' && v.command && v.feedback,
  )
  expect(variable, 'двоичная переменная в типе').toBeTruthy()

  await pickType()
  await openTab('builder')
  await expect(page.getByTestId('grms-builder')).toBeVisible()

  if (!(await page.getByTestId(`grms-zone-${ZONE}`).isVisible().catch(() => false))) {
    await fillField('grms-zone-code', ZONE)
    await fillField('grms-zone-title', 'Комната прогона')
    await page.getByTestId('grms-zone-add').click()
    await expect(page.getByTestId(`grms-zone-${ZONE}`)).toBeVisible({ timeout: 20_000 })
  }

  const element = page.getByTestId(`grms-element-${ELEMENT}`)
  if (!(await element.isVisible().catch(() => false))) {
    await openSelect('grms-element-kind')
    // Именно группа света: у неё обязательная возможность `toggle`, под
    // которую в файле ПНР заведомо есть двоичная переменная.
    await page.locator('li[data-value="light_group"]').click()
    await fillField('grms-element-slug', ELEMENT)
    await fillField('grms-element-title', 'Свет прогона')
    await page.getByTestId('grms-element-add').click()
    await expect(element).toBeVisible({ timeout: 20_000 })
    // Пока привязки нет — элемент честно говорит, что не опубликуется.
    await expect(element).toHaveAttribute('data-publishable', 'false')
  }

  // Стенд живёт между прогонами: привязка могла остаться с прошлого раза, и
  // повторять её значило бы проверять поведение на дубле, а не на привязке.
  if ((await element.getAttribute('data-publishable')) !== 'true') {
    await openSelect('grms-bind-element')
    await page.locator(`li[data-value="${ELEMENT}"]`).click()
    await openSelect('grms-bind-capability')
    await page.locator('li[data-value="toggle"]').click()
    await openSelect('grms-bind-variable')
    await page.locator(`li[data-value="${variable!.key}"]`).click()
    await page.getByTestId('grms-bind-save').click()
  }

  await expect(element).toHaveAttribute('data-publishable', 'true', { timeout: 20_000 })
})

test('публикация: элемент уезжает в снимок версией', async ({ request }) => {
  test.setTimeout(120_000)
  const token = await adminToken(request)
  // Стенд живёт между прогонами, поэтому считаем ОТ ТЕКУЩЕГО состояния, а не
  // от «версии №1»: на втором прогоне её давно перекрыли.
  const before = await versionNumbers(request, token)

  await pickType()
  await openTab('versions')
  await page.getByTestId('grms-publish').click()

  const expected = Math.max(0, ...before) + 1
  await expect(page.getByTestId(`grms-version-${expected}`)).toBeVisible({ timeout: 30_000 })

  const after = await versionList(request, token)
  expect(after.find((v) => v.is_current)?.version).toBe(expected)
})

test('план: кадр, разметка мышью, привязка к опубликованному элементу и сохранение', async ({
  request,
}) => {
  // Кадр реально уезжает в медиапайплайн, а ночной считается фоном — это
  // секунды, а не миллисекунды.
  test.setTimeout(180_000)
  await pickType()
  await openTab('plan')
  await expect(page.getByTestId('grms-plan-editor')).toBeVisible({ timeout: 20_000 })

  const stage = page.getByTestId('grms-plan-stage')
  if (!(await stage.isVisible().catch(() => false))) {
    await expect(page.getByTestId('grms-plan-no-frame')).toBeVisible()
    await page.getByTestId('grms-plan-lit-input').setInputFiles(RENDER)
    await page.getByTestId('grms-plan-upload').click()
    await expect(stage).toBeVisible({ timeout: 120_000 })
  }

  // Стенд живёт между прогонами, и каждый добавляет по зоне. Подрезаем, чтобы
  // разметка не росла бесконечно от прогона к прогону.
  const token = await adminToken(request)
  if ((await zoneCount()) > 2) {
    const current = await apiGet<{ geometry: PlanGeometryPayload }>(
      request,
      token,
      `/api/cms/grms/types/${TYPE_CODE}/plan`,
    )
    const trimmed = { ...current.geometry, zones: current.geometry.zones.slice(0, 1) }
    await request.put(`${API}/api/cms/grms/types/${TYPE_CODE}/plan`, {
      data: trimmed,
      headers: apiHeaders(token),
    })
    // ИМЕННО pickType, а не просто перезагрузка: после неё выбранным
    // становится первый тип списка, и разметка поехала бы в чужой план.
    await pickType()
    await openTab('plan')
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
    `/api/cms/grms/types/${TYPE_CODE}/plan`,
  )
  expect(plan.geometry.zones.length).toBe(before + 1)
  // Маска считается из зоны на сохранении, а не рисуется отдельно.
  expect(plan.geometry.zones.every((zone) => zone.mask)).toBeTruthy()
  expect(plan.geometry.zones.some((zone) => zone.controlId)).toBeTruthy()

  await page.screenshot({ path: path.join(SHOTS, 'plan-editor-dark.png'), fullPage: true })
  await page.getByTestId('theme-toggle').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(SHOTS, 'plan-editor-light.png'), fullPage: true })
  await page.getByTestId('theme-toggle').click()
})

test('предпросмотр плана: клик по зоне переключает свет', async () => {
  await pickType()
  await openTab('plan')
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
  const token = await adminToken(request)
  const plan = await apiGet<{ geometry: Record<string, unknown> }>(
    request,
    token,
    `/api/cms/grms/types/${TYPE_CODE}/plan`,
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
  const saved = await request.put(`${API}/api/cms/grms/types/${TYPE_CODE}/plan`, {
    data: broken,
    headers: apiHeaders(token),
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()

  await pickType()
  await openTab('versions')
  await page.getByTestId('grms-publish').click()
  await expect(page.getByText(/План ссылается/)).toBeVisible({ timeout: 20_000 })

  // Убираем битую ссылку: следующий шаг прогона должен публиковаться.
  const fixed = await request.put(`${API}/api/cms/grms/types/${TYPE_CODE}/plan`, {
    data: plan.geometry,
    headers: apiHeaders(token),
  })
  expect(fixed.ok()).toBeTruthy()
})

test('откат возвращает предыдущую версию', async ({ request }) => {
  test.setTimeout(120_000)
  const token = await adminToken(request)
  const before = await versionNumbers(request, token)
  const target = Math.min(...before)

  await pickType()
  await openTab('versions')
  await page.getByTestId('grms-publish').click()

  const published = Math.max(...before) + 1
  await expect(page.getByTestId(`grms-version-${published}`)).toBeVisible({ timeout: 30_000 })

  // Откат — это НОВАЯ версия с телом старой, а не переписанная история.
  await page.getByTestId(`grms-rollback-${target}`).click()
  await expect(page.getByTestId(`grms-version-${published + 1}`)).toBeVisible({ timeout: 30_000 })

  const after = await versionList(request, token)
  const current = after.find((v) => v.is_current)!
  expect(current.rolled_back_from).toBe(target)
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
