import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, HOTEL, signInToCms } from './helpers'

/**
 * ДВА СПЛОШНЫХ ОБХОДА CMS — по одному правилу на обход.
 *
 * 1. ЗАГОЛОВОК СТРАНИЦЫ = ПУНКТ МЕНЮ. Человек нажал «Дашборд» и обязан
 *    прочитать на странице «Дашборд». Пока пункт и заголовок жили в разных
 *    ключах локали, они расходились по одному за раз и незаметно: «Пульт» под
 *    «Дашбордом», «Номера» под «Номерным фондом», «Маркетинговые бейджи» под
 *    «Маркетингом». Каждое расхождение по отдельности мелочь, вместе — панель,
 *    в которой не работает память места.
 *
 * 2. В РУССКОМ ИНТЕРФЕЙСЕ НЕТ ЧУЖОГО АЛФАВИТА. Приём уже был у терминологии
 *    (`venue-not-point.spec.ts`), но не у языка. `Object.values(title)[0]`
 *    берёт первое значение по порядку ключей словаря — то есть по алфавиту, —
 *    и в русской CMS названия заведений печатались арабской вязью, потому что
 *    «ar» стоит раньше «en» и «ru». Ловится это только сплошным обходом: на
 *    экране, где такое поле одно, его никто не ищет.
 *
 * Обход идёт ПО МЕНЮ, которое отдал сервер, а не по списку в тесте: раздел,
 * пришедший с бэкенда, но забытый здесь, иначе остался бы непроверенным.
 */

/** Арабица и китайские иероглифы. Латиница разрешена: коды, бренды, единицы. */
const FOREIGN = /[؀-ۿ一-鿿]/

/** Разделы вне /cms живут своим шеллом — обход меню сюда не ведёт. */
const OUTSIDE_CMS = new Set(['tracker'])

interface NavItem {
  key: string
  label: string
  href: string
}

/**
 * Разделы — из МЕНЮ, которое отдал сервер. Список в тесте отстал бы от
 * навигации в первый же день, и забытый раздел остался бы непроверенным.
 */
async function navItems(page: Page): Promise<NavItem[]> {
  const links = page.locator('[data-testid^="cms-nav-"]')
  await expect(links.first()).toBeVisible({ timeout: 20_000 })
  const items: NavItem[] = []
  for (const handle of await links.all()) {
    const key = ((await handle.getAttribute('data-testid')) ?? '').replace('cms-nav-', '')
    if (OUTSIDE_CMS.has(key)) continue
    items.push({
      key,
      label: (await handle.innerText()).trim(),
      href: (await handle.getAttribute('href')) ?? '',
    })
  }
  return items
}

/**
 * Переход ПОЛНОЙ ЗАГРУЗКОЙ, а не кликом.
 *
 * Клик меняет адрес раньше, чем размонтируется предыдущий экран, и обход
 * успевал прочитать заголовок ПРЕДЫДУЩЕГО раздела — то есть врал бы про
 * расхождение там, где его нет, и молчал бы там, где оно есть.
 */
async function openSection(page: Page, item: NavItem): Promise<void> {
  await page.goto(item.href)
  await expect(page.getByTestId('cms-page-title'), `раздел «${item.label}» без заголовка`).toBeVisible(
    { timeout: 20_000 },
  )
}

test.describe('CMS: заголовки и язык', () => {
  test('заголовок каждого раздела совпадает с его пунктом меню', async ({ page }) => {
    await signInToCms(page)
    const items = await navItems(page)
    expect(items.length, 'меню не отдало ни одного раздела').toBeGreaterThan(5)

    const mismatched: string[] = []
    for (const item of items) {
      await openSection(page, item)
      const heading = (await page.getByTestId('cms-page-title').innerText()).trim()
      if (heading !== item.label) {
        mismatched.push(`${item.key}: меню «${item.label}» ≠ заголовок «${heading}»`)
      }
    }

    expect(mismatched, `Заголовки разошлись с меню:\n${mismatched.join('\n')}`).toEqual([])
  })

  test('в русском интерфейсе нет арабицы и иероглифов ни в одном разделе', async ({ page }) => {
    await signInToCms(page)
    const items = await navItems(page)

    const dirty: string[] = []
    for (const item of items) {
      await openSection(page, item)
      // Списки доезжают позже заголовка — иначе обход прошёл бы по скелетам.
      await page.waitForLoadState('networkidle')

      const text = await page.locator('main').innerText()
      const found = text.match(new RegExp(`.{0,24}${FOREIGN.source}.{0,24}`, 'u'))
      if (found) dirty.push(`${item.key}: …${found[0].replace(/\s+/g, ' ')}…`)
    }

    expect(dirty, `Чужой алфавит в русском интерфейсе:\n${dirty.join('\n')}`).toEqual([])
  })

  test('«где порог переопределён» открывается и печатает названия по-русски', async ({
    page,
    request,
  }) => {
    /*
      Отдельно от обхода: список порогов лежит НЕ на первом экране раздела
      сервисов, и обход по меню до него не доходит. А ручка под ним ещё вчера
      отвечала пятисоткой — статический адрес стоял ниже `/services/{id}` и
      целиком доставался ему.
    */
    const health = await request.get(`${API}/api/cms/services/sla-overrides`, {
      headers: await bearer(request),
    })
    expect(health.status(), await health.text()).toBe(200)

    await signInToCms(page)
    await page.goto('/cms/services')
    const card = page.getByTestId('cms-sla-overrides')
    await expect(card).toBeVisible({ timeout: 20_000 })
    const text = await card.innerText()
    expect(text).not.toMatch(FOREIGN)
    expect(text).toMatch(/[А-Яа-я]/)
  })
})

async function bearer(request: import('@playwright/test').APIRequestContext) {
  const login = await request.post(`${API}/api/staff/auth/login`, {
    data: { email: 'owner@crystal.local', password: 'chef12345' },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  return {
    Authorization: `Bearer ${(await login.json()).access}`,
    'X-Hotel-Subdomain': HOTEL,
  }
}
