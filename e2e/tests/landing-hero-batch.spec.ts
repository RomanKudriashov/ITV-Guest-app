import { expect, test } from './fixtures'

/**
 * ПОЛОСА ЛЕНДИНГА ВЫЕЗЖАЕТ, ДАЖЕ КОГДА НАБЛЮДАТЕЛЬ ОТДАЁТ ПАЧКУ (партия 25).
 *
 * Полоса показывается, когда обложка ушла из вида (IntersectionObserver).
 * Хук брал ПЕРВУЮ запись вызова: `([entry]) => …`. Наблюдатель же отдаёт
 * записи пачкой, если не успел вызвать обработчик между изменениями, — на
 * нагруженной машине первая (ещё «видна») и вторая (после прокрутки, «не
 * видна») приходят вместе, хук брал устаревшую, и полоса не выезжала никогда:
 * прокрутка 1080, обложка целиком выше окна, `data-shown="false"` (замер в
 * прогоне части В). Поодиночке не воспроизводилось — пачки не было.
 *
 * Условие явное: наблюдатель подменён обёрткой, которая копит записи и
 * отдаёт их одним вызовом через 500 мс — ровно то, что делает занятый
 * главный поток.
 */

const ROOT = `http://guest.localhost:${process.env.E2E_FRONT_PORT ?? '5183'}`

test('пачка записей наблюдателя: полоса лендинга выезжает по последней', async ({ page }) => {
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

  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing-hero')).toBeVisible({ timeout: 30_000 })
  // Прокрутка сразу после первой записи — та попадёт в одну пачку со второй.
  await page.waitForTimeout(100)
  await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.2)))
  await expect(page.getByTestId('landing-nav'), 'полоса не выехала: хук взял устаревшую запись пачки').toHaveAttribute(
    'data-shown',
    'true',
    { timeout: 5_000 },
  )
})
