import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * АНИМАЦИИ ЛЕНДИНГА РЕШАЮТ ПО СВЕЖЕЙ ЗАПИСИ НАБЛЮДАТЕЛЯ (партия 30, п.55).
 *
 * Тот же шаблон, что у полосы лендинга (`landing-hero-batch.spec.ts`): план
 * номера и схемы брали ПЕРВУЮ запись вызова `([entry]) => …`, а занятый поток
 * отдаёт записи пачкой — первая в ней устаревшая «не видна». План так и не
 * начинал показ, схема не запускалась, хотя их долистали.
 *
 * Условие явное: наблюдатель подменён обёрткой, копящей записи 500 мс, и
 * долистывание случается внутри этого окна — пачка [не видна, видна].
 */

const ROOT = `http://guest.localhost:${process.env.E2E_FRONT_PORT ?? '5183'}`

async function batchingObserver(page: Page) {
  await page.addInitScript(() => {
    const Native = window.IntersectionObserver
    window.IntersectionObserver = class BatchingObserver {
      private queue: IntersectionObserverEntry[] = []
      private timer: number | null = null
      private inner: IntersectionObserver
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.inner = new Native((entries) => {
          this.queue.push(...entries)
          if (this.timer === null) {
            this.timer = window.setTimeout(() => {
              const batch = this.queue
              this.queue = []
              this.timer = null
              callback(batch, this as unknown as IntersectionObserver)
            }, 500)
          }
        }, options)
      }
      observe(target: Element) {
        this.inner.observe(target)
      }
      unobserve(target: Element) {
        this.inner.unobserve(target)
      }
      disconnect() {
        this.inner.disconnect()
      }
      takeRecords() {
        return this.inner.takeRecords()
      }
    } as unknown as typeof IntersectionObserver
  })
}

async function openAndScrollTo(page: Page, testId: string) {
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing-hero')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(100)
  // Сразу, без плавности: запись «видна» ляжет в одну пачку с первой.
  await page.evaluate((id) => {
    document.querySelector(`[data-testid="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, testId)
}

test('план номера: долистали в пачке записей — показ начинается', async ({ page }) => {
  await batchingObserver(page)
  await openAndScrollTo(page, 'landing-room-plan')
  const plate = page.getByTestId('landing-room-plan').locator('[data-light]')
  await expect(plate, 'показ не начался: решение по устаревшей записи пачки').toHaveAttribute('data-light', 'true', {
    timeout: 6_000,
  })
})

test('схема заказа: долистали в пачке записей — схема запускается', async ({ page }) => {
  await batchingObserver(page)
  await openAndScrollTo(page, 'flow-order')
  const nodes = page.locator('[data-testid^="flow-order-node-"]')
  await expect(nodes.nth(1), 'схема не запустилась: решение по устаревшей записи пачки').toHaveAttribute(
    'aria-current',
    'true',
    { timeout: 8_000 },
  )
})
