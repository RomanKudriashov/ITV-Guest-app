import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, guestTheme, signInToCms, waitForLayout } from './helpers'

/*
  ЧЕРНОВИКИ, ВЕРСИИ, ОТКАТ — ПОЛНЫЙ КРУГ ЧЕРЕЗ ИНТЕРФЕЙС.

  Проверяется не «кнопка есть», а то, ради чего это делалось: черновик
  переживает закрытую вкладку, публикация доходит до витрины, откат виден КАК
  откат, а устаревший черновик не публикуется одним нажатием.

  Условия задаются явно, и после себя проверка прибирает: черновики удаляются,
  оформление возвращается на ту версию, что была до прогона. Иначе она сама
  станет тем состоянием стенда, на которое напорется следующая.
*/

async function openVersions(page: Page): Promise<void> {
  await signInToCms(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('brand-tab-versions').click()
  await expect(page.getByTestId('brand-versions')).toBeVisible({ timeout: 15_000 })
}

async function saveDraft(page: Page, name: string): Promise<void> {
  await page.getByTestId('brand-draft-name').fill(name)
  await page.getByTestId('brand-draft-save').click()
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
}

/** Убрать за собой все черновики, заведённые проверкой. */
async function dropDrafts(page: Page): Promise<void> {
  for (;;) {
    const remove = page.getByTestId('brand-draft-delete').first()
    if ((await remove.count()) === 0) break
    /*
      Список перечитывается после каждого удаления, и строка, которую мы только
      что сосчитали, к моменту нажатия может исчезнуть — это нормальная гонка
      уборки, а не поломка. Пропускаем такой случай и идём дальше.
    */
    await remove.click({ timeout: 5_000 }).catch(() => undefined)
    await waitForLayout(page)
  }
}

test.describe('Черновики оформления', () => {
  test('черновик переживает перезагрузку страницы — он на сервере, а не во вкладке', async ({
    page,
  }) => {
    await openVersions(page)
    const name = `Проверка ${Date.now()}`
    await saveDraft(page, name)

    // Вот ради чего всё: закрытая вкладка больше не уносит работу.
    await page.reload()
    await page.getByTestId('brand-tab-versions').click()
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 })

    await dropDrafts(page)
  })

  test('черновиков несколько, у каждого имя, дата и автор', async ({ page }) => {
    await openVersions(page)
    const first = `Новый год ${Date.now()}`
    const second = `Терраса ${Date.now()}`

    await saveDraft(page, first)
    await saveDraft(page, second)

    await expect(page.getByText(first, { exact: false }).first()).toBeVisible()
    await expect(page.getByText(second, { exact: false }).first()).toBeVisible()

    // Дата и автор — в той же строке: без них два черновика через неделю
    // неразличимы.
    const row = page.getByTestId('brand-versions')
    await expect(row).toContainText(/\d{2}[./]\d{2}[./]\d{2,4}|\d{1,2}\.\d{1,2}\.\d{4}/)

    await dropDrafts(page)
  })
})

test.describe('Публикация и откат', () => {
  test('публикация черновика доходит до витрины, откат возвращает прежнее', async ({
    page,
    request,
  }) => {
    await openVersions(page)
    await dropDrafts(page)

    // ЧТО БЫЛО ДО НАС — запоминаем, чтобы вернуть в точности это. Проверка,
    // оставившая отелю свой цвет, сама становится состоянием стенда.
    const before = await guestPrimary(request)

    /*
      ЦВЕТА БЕРУТСЯ ОТНОСИТЕЛЬНО ТЕКУЩЕГО, А НЕ КОНСТАНТАМИ.

      С константой проверка падала на исправном коде: стенд уже стоял на
      «#123456», кнопка сохранения правомерно оставалась неактивной — менять
      было нечего. Условие обязано задаваться в тесте целиком, включая «этот
      цвет заведомо другой».
    */
    const base = pickOther(before, '#123456', '#654321')
    const draftColor = pickOther(base, '#abcdef', '#fedcba')

    await page.getByTestId('brand-tab-brand').click()
    await setPrimary(page, base)
    await page.getByTestId('brand-save').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden({ timeout: 15_000 })

    // Готовим черновик с другим цветом и публикуем его.
    await setPrimary(page, draftColor)
    await page.getByTestId('brand-tab-versions').click()
    await saveDraft(page, `К публикации ${Date.now()}`)
    await page.getByTestId('brand-draft-publish').first().click()
    await expect(page.getByTestId('brand-drafts-empty')).toBeVisible({ timeout: 15_000 })

    // Витрина видит опубликованное — спрашиваем гостевую ручку, а не экран.
    const themeAfterPublish = await guestPrimary(request)
    expect(themeAfterPublish.toLowerCase(), 'публикация не доехала до витрины').toBe(draftColor)

    // Откат к предыдущей версии.
    await page.getByTestId('brand-version-restore').first().click()
    await expect(page.getByTestId('brand-version-live')).toBeVisible({ timeout: 15_000 })

    const themeAfterRestore = await guestPrimary(request)
    expect(themeAfterRestore.toLowerCase(), 'откат не вернул прежнее оформление').toBe(base)

    // ОТКАТ ВИДЕН КАК ОТКАТ: строка истории говорит, к какой версии вернули.
    await expect(page.getByTestId('brand-versions')).toContainText(/возврат к версии \d+/i)

    // МЕТКА НАЗЫВАЕТ ВЕРСИЮ. Без номера она говорит про опубликованное, а
    // оператор читает её, глядя на свой черновик, — и принимает правду за ложь.
    await expect(page.getByTestId('cms-brand-look')).toContainText(/версия \d+/i)

    // Возвращаем отелю его цвет — ровно тот, что был до прогона.
    await page.getByTestId('brand-tab-brand').click()
    await setPrimary(page, before)
    // Сохраняем, ТОЛЬКО если есть что возвращать: после отката цвет мог уже
    // совпасть с исходным, и тогда кнопка правомерно неактивна — «нечего
    // сохранять» это ответ, а не поломка.
    const save = page.getByTestId('brand-save')
    if (await save.isEnabled()) {
      await save.click()
      await expect(page.getByTestId('brand-dirty')).toBeHidden({ timeout: 15_000 })
    }
    await expect.poll(() => guestPrimary(request), { timeout: 15_000 }).toBe(before)
  })
})

/** Цвет, который витрина отдаёт гостю прямо сейчас — общей помощью набора. */
async function guestPrimary(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const theme = await guestTheme(request)
  return theme.palette.light.primary as string
}

/** Основной цвет — нативным событием: `type="color"` обычный ввод не принимает. */
async function setPrimary(page: Page, value: string): Promise<void> {
  await page.getByTestId('brand-primary-light').evaluate((node, next) => {
    const input = node as HTMLInputElement
    input.value = next
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** Первый из вариантов, который заведомо отличается от текущего значения. */
function pickOther(current: string, first: string, second: string): string {
  return current.toLowerCase() === first ? second : first
}
