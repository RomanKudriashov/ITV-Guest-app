import { expect, test } from '@playwright/test'

import { plannedRemovals, type StandSnapshot } from '../fixtures/stand'

/**
 * УБОРКА СТЕНДА НЕ УБИРАЕТ ПО ПУСТОМУ СНИМКУ.
 *
 * Уборка держится на правиле «чего не было в снимке до прогона — создано
 * прогоном». Правило верное ровно до тех пор, пока снимок этот вид ВИДЕЛ.
 * Состав читался мягко: не прошёл запрос — список молча оставался пустым, и
 * правило превращало пустоту в приговор всему отелю. Проверено на живом
 * стенде: уборка по такому снимку удалила три заведения без заказов и
 * выключила остальные вместе с их точками исполнения — то есть выключила
 * приём заказов по всему отелю. Одна неудачная авторизация в момент снимка —
 * и показывать клиенту нечего.
 *
 * СТОРОЖ ПРОВЕРЯЕТ РЕШЕНИЕ, А НЕ ПОСЛЕДСТВИЯ, и это не упрощение. Сторож,
 * который зовёт настоящую уборку, ломает стенд ровно в тот прогон, когда
 * защита отвалилась, — то есть наказывает за поломку тем же, от чего защищает.
 * Мина жила в решении «что считать новым», решение вынесено чистой функцией, и
 * меряется оно: без сети, без прав и без последствий.
 */

const snapshot = (over: Partial<StandSnapshot> = {}): StandSnapshot => ({
  hotelIds: ['hotel-1', 'hotel-2'],
  serviceIds: ['svc-kitchen', 'svc-bar', 'svc-spa'],
  categoryIds: ['cat-hot', 'cat-drinks'],
  itemIds: ['item-steak'],
  ...over,
})

test('снимок прочитан: убирается ровно то, чего в нём не было', () => {
  const before = snapshot()
  const after = snapshot({
    hotelIds: [...before.hotelIds, 'hotel-new'],
    serviceIds: [...before.serviceIds, 'svc-new'],
    categoryIds: [...before.categoryIds, 'cat-new'],
    itemIds: [...before.itemIds, 'item-new'],
  })

  const planned = plannedRemovals(before, after)
  expect(planned.hotels).toEqual(['hotel-new'])
  expect(planned.services).toEqual(['svc-new'])
  expect(planned.categories).toEqual(['cat-new'])
  expect(planned.items).toEqual(['item-new'])
  expect(planned.blind, 'снимок полон, слепых видов быть не должно').toEqual([])
})

test('вид не прочитался: по нему не убирается НИЧЕГО, даже если после прогона он полон', () => {
  // Ровно тот случай, который случался: запрос сервисов не прошёл, остальное
  // прочиталось. После прогона в отеле девять сервисов — и все они «новые».
  const before = snapshot({ serviceIds: [] })
  const after = snapshot({
    serviceIds: ['svc-kitchen', 'svc-bar', 'svc-spa', 'svc-terrace', 'svc-sakura'],
  })

  const planned = plannedRemovals(before, after)
  expect(planned.services, 'уборка собралась снести отель по пустому виду').toEqual([])
  expect(planned.blind, 'слепой вид не назван вслух').toContain('service')
  // Остальные виды прочитаны — они убираются как обычно.
  expect(planned.hotels).toEqual([])
  expect(planned.categories).toEqual([])
})

test('снимок пуст целиком: не убирается ни один вид', () => {
  const before: StandSnapshot = { hotelIds: [], serviceIds: [], categoryIds: [], itemIds: [] }
  const after = snapshot()

  const planned = plannedRemovals(before, after)
  expect(planned.hotels).toEqual([])
  expect(planned.services).toEqual([])
  expect(planned.categories).toEqual([])
  expect(planned.items).toEqual([])
  expect(planned.blind).toEqual(['hotel', 'service', 'category', 'item'])
})
