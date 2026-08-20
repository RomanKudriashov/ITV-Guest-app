import { expect, test, type Page } from '@playwright/test'

import { DEMO_ROOM } from './helpers'

/**
 * КОРЗИНА НЕ ЗАНИМАЕТ ПОСТОЯННУЮ ПОЛОСУ.
 *
 * Нижняя полоса «в корзине N позиций» висела на каждом экране каталога всё
 * время, пока в корзине что-то есть, и ничего при этом не сообщала: сумма не
 * меняется, пока гость не тронет корзину. Теперь она всплывает на секунды
 * после добавления, а постоянный вход — иконка с числом, которая видна всегда.
 *
 * Четыре укуса: полоса мелькнула и ушла; счётчик пережил перезагрузку; пустая
 * корзина без числа; фото в корзине то же, что в меню.
 */

const PHONE = { width: 390, height: 844 }

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
}

/** Открыть меню первого заведения на витрине. */
/**
 * Заходим в кухню ЧЕРЕЗ ПЛИТКУ, а не прямым адресом: `/venue/kitchen`,
 * открытый напрямую, каталога не грузит вовсе (0 кнопок добавления) — витрина
 * ставит контекст заведения при переходе. Отдельный дефект, здесь просто
 * обходим.
 */
async function openKitchen(page: Page): Promise<void> {
  await page.locator('[data-testid^="guest-home-tile-"]').first().click()
  await expect(page.getByTestId(`guest-qty-plus-${DIRECT_ITEM}`)).toBeVisible({
    timeout: 20_000,
  })
}

/**
 * Блюдо БЕЗ модификаторов: кладётся прямым нажатием, без шторки.
 *
 * Выбрано намеренно. Позиция с модификаторами открывает шторку, а шторка едет
 * анимацией: нажатие по ещё не вставшей кнопке не регистрируется, позиция молча
 * не добавляется, и тест начинает гоняться с анимацией вместо проверки
 * корзины. Здесь проверяется вход в корзину, а не работа шторки — её проверяет
 * `guest-order.spec.ts`.
 */
const DIRECT_ITEM = 'carbonara'

async function addDirectItem(page: Page): Promise<void> {
  await page.getByTestId(`guest-qty-plus-${DIRECT_ITEM}`).click()
}

test.use({ viewport: PHONE })

test.describe('Вход в корзину на телефоне', () => {
  test.slow()

  test('пустая корзина: иконка есть, числа нет', async ({ page }) => {
    await enterAsGuest(page)
    // Вход виден ВСЕГДА — постоянный вход тем и ценен, что его не ищут.
    await expect(page.getByTestId('guest-cart-button')).toBeVisible()
    // А числа при нуле быть не должно: «0» в кружке — шум, а не сообщение.
    // MUI держит узел в разметке и гасит его классом, поэтому смотрим глазами:
    // кружок не виден, и в имени кнопки нет числа.
    await expect(
      page.locator('[data-testid="guest-cart-count"] .MuiBadge-badge'),
    ).not.toBeVisible()
    await expect(page.getByTestId('guest-cart-button')).toHaveAttribute(
      'aria-label',
      /^(Корзина|Cart)$/,
    )
    // И постоянной полосы внизу тоже нет.
    await expect(page.getByTestId('guest-cart-bar')).toHaveCount(0)
  })

  test('добавили: полоса мелькнула и ушла, счётчик вырос', async ({ page }) => {
    await enterAsGuest(page)
    await openKitchen(page)

    // Ждать полосу начинаем ДО добавления: она живёт четыре секунды, и
    // подписаться на неё после — значит гоняться с таймером.
    const bar = page.getByTestId('guest-cart-bar')
    const appeared = bar.waitFor({ state: 'visible', timeout: 20_000 })
    await addDirectItem(page)

    // Полоса ПОЯВИЛАСЬ — это подтверждение действия.
    await appeared
    await expect(bar).toContainText(/Добавлено|Added/)

    // Счётчик на постоянном входе вырос.
    await expect(
      page.locator('[data-testid="guest-cart-count"] .MuiBadge-badge'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('[data-testid="guest-cart-count"] .MuiBadge-badge'),
    ).toHaveText('1')

    // И УШЛА САМА. Четыре секунды плюс запас на анимацию и медленный стенд.
    await expect(bar).toHaveCount(0, { timeout: 15_000 })

    // Вход при этом на месте — путь к заказу не пропал вместе с полосой.
    await expect(page.getByTestId('guest-cart-button')).toBeVisible()
  })

  test('перезагрузка: счётчик на месте, полоса не всплывает', async ({ page }) => {
    await enterAsGuest(page)
    await openKitchen(page)
    await addDirectItem(page)
    await expect(
      page.locator('[data-testid="guest-cart-count"] .MuiBadge-badge'),
    ).toHaveText('1', { timeout: 15_000 })

    await page.reload()
    await expect(page.getByTestId('guest-cart-button')).toBeVisible({ timeout: 20_000 })
    await expect(
      page.locator('[data-testid="guest-cart-count"] .MuiBadge-badge'),
    ).toHaveText('1', { timeout: 15_000 })
    // Полоса — ответ на ДЕЙСТВИЕ, а не на наличие корзины: после F5 её нет.
    await expect(page.getByTestId('guest-cart-bar')).toHaveCount(0)
  })

  test('вход ведёт в НЕПУСТУЮ корзину', async ({ page }) => {
    /*
      Корзина разложена по заведениям и лежит вне `/venue`: `/cart` без
      параметра показывает пустой экран даже когда в хранилище что-то есть.
      Пока единственным входом была полоса каталога, она подставляла заведение
      сама. У постоянной кнопки такого контекста нет — и без него она вела бы
      в «корзина пуста».
    */
    await enterAsGuest(page)
    await openKitchen(page)
    await addDirectItem(page)

    await page.getByTestId('guest-cart-button').click()
    await expect(page.getByTestId('guest-cart')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('guest-cart')).not.toContainText(/пуста|is empty/i)
  })

  test('фото в корзине — то же, что в меню', async ({ page }) => {
    /*
      Строка корзины хранит СНИМОК позиции на момент добавления. Цену и
      модификаторы заморозить правильно — гость на них согласился. А картинка к
      сделке не относится, и замороженной она начинает врать: блюдо,
      добавленное до того, как отель загрузил фото, оставалось в корзине серым
      квадратом, хотя в меню у него давно есть снимок.
    */
    await enterAsGuest(page)
    await openKitchen(page)

    const menuImages = await page.evaluate(() =>
      [...document.querySelectorAll('img')]
        .map((img) => img.getAttribute('src') || '')
        .filter((src) => src.includes('guest-media')),
    )
    expect(menuImages.length, 'в меню нет ни одного фото — проверять нечего').toBeGreaterThan(0)

    await addDirectItem(page)
    await page.getByTestId('guest-cart-button').click()
    await expect(page.getByTestId('guest-cart')).toBeVisible({ timeout: 15_000 })

    // В корзине есть картинка, и она ЗАГРУЗИЛАСЬ, а не осталась серым местом.
    const loaded = await page.evaluate(() =>
      [...document.querySelectorAll('img')]
        .filter((img) => (img.getAttribute('src') || '').includes('guest-media'))
        .map((img) => (img as HTMLImageElement).naturalWidth),
    )
    expect(loaded.length, 'в корзине нет фотографии').toBeGreaterThan(0)
    expect(Math.max(...loaded), 'фотография не загрузилась').toBeGreaterThan(0)
  })
})
