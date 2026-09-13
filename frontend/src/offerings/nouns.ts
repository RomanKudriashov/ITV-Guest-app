/**
 * ============================================================================
 * КАК НАЗЫВАЕТСЯ СОДЕРЖИМОЕ КАТАЛОГА — близнец `apps/catalog/nouns.py`
 * ============================================================================
 *
 * «Добавить блюдо» на экране спа — не мелочь стиля: сотрудник читает кнопку
 * буквально и на секунду теряет уверенность, что он там, где нужно. Слово
 * выводится из типа заведения и приходит в ответе сервера полем `noun`.
 *
 * ЗДЕСЬ ТОЛЬКО КОД СЛОВА, САМИХ СЛОВ ЗДЕСЬ НЕТ. «Блюдо» среднего рода,
 * «услуга» женского, «товар» мужского, и фразы вокруг них согласуются
 * по-разному: «Новое блюдо», но «Новая услуга» и «Новый товар». Склеивать
 * фразу из кусков нельзя ни в одном языке с родом и падежами, поэтому фразы
 * лежат целиком в переводах — `catalog.<noun>.*` — а код выбирает набор.
 *
 * ЗАЧЕМ КАРТА ЗДЕСЬ, ЕСЛИ ОНА ЕСТЬ НА СЕРВЕРЕ. Экран не всегда знает
 * заведение: список бейджей показывает позиции всего отеля, редактор
 * открывается по ссылке раньше, чем доедет раздел. Карта нужна как падение, а
 * не как второй источник правды — поэтому она сверяется с серверной сторожем
 * `backend/tests/test_registry_twins.py`, и разойтись молча они не могут.
 */

import { useTranslation } from 'react-i18next';

/** Слово, которым заведение называет содержимое каталога. */
export type OfferingNoun = 'dish' | 'service' | 'goods' | 'page' | 'item';

export const OFFERING_NOUNS: readonly OfferingNoun[] = [
  'dish',
  'service',
  'goods',
  'page',
  'item',
] as const;

/**
 * Тип заведения → слово. Держать синхронной с `SERVICE_TYPE_TO_NOUN` в
 * `apps/catalog/nouns.py`; расхождение ловит сторож близнецов.
 */
export const SERVICE_TYPE_TO_NOUN: Record<string, OfferingNoun> = {
  restaurant: 'dish',
  bar: 'dish',
  room_service: 'dish',
  // Мини-бар и магазин — один тип заведения, и «товар» покрывает оба смысла.
  // Обратное неверно: сувенир блюдом не назовёшь.
  minibar: 'goods',
  spa: 'service',
  pool: 'service',
  transfer: 'service',
  concierge: 'service',
  excursions: 'service',
  housekeeping: 'service',
  // Единственный тип без заказа: гость это читает. «Раздел» занят категориями.
  info: 'page',
  // «Свой» — заведение, про которое система заранее не знает ничего.
  custom: 'item',
};

/** Слово для типа заведения. Незнакомый тип — нейтральная «позиция». */
export function nounForServiceType(serviceType?: string | null): OfferingNoun {
  if (!serviceType) return 'item';
  return SERVICE_TYPE_TO_NOUN[serviceType] ?? 'item';
}

/** Ключи фраз набора — ровно те, что лежат в `catalog.<noun>` во всех локалях. */
export type CatalogPhrase =
  | 'plural'
  | 'add'
  | 'count'
  | 'search'
  | 'emptyHint'
  | 'newTitle'
  | 'saved'
  | 'deleted'
  | 'deleteTitle'
  | 'deleteBody'
  | 'categoryNotEmpty'
  | 'categoryDeleteBody'
  | 'categoryCascade'
  | 'loadFailed'
  | 'what';

/**
 * Фразы каталога для одного слова: `w('add')` вместо `t('menu.addItem')`.
 *
 * Экран не знает, какое слово ему досталось, и не должен: он спрашивает фразу
 * по РОЛИ — кнопка, заголовок, подтверждение удаления. Так экран нельзя
 * «забыть перевести» под новый тип заведения: набор либо есть целиком, либо
 * его отсутствие видно сразу на всех экранах, а не на одной кнопке.
 *
 * `noun` не задан (данные ещё едут) — берём нейтральный набор: «Позиции»
 * уместны везде, а «Блюда» на экране спа — нет.
 */
export function useCatalogWords(noun: OfferingNoun | null | undefined) {
  const { t } = useTranslation();
  const key = noun ?? 'item';
  return (phrase: CatalogPhrase, options?: Record<string, unknown>) =>
    t(`catalog.${key}.${phrase}`, options ?? {});
}
