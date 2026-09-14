import type { ItemDetail, MenuItem } from '@/guest/api/types';
import type { Item as CmsItem, Translated } from '@/api/types';

/**
 * ЧТО ПОКАЗЫВАЕТ ПРЕВЬЮ БРЕНДА — И ЧЕМ ЭТО ЧЕСТНО.
 *
 * Раньше здесь жили три выдуманных блюда: «Ribeye Steak», «Caesar Salad» и
 * «Vanilla Pavlova» — с английскими описаниями, рублёвыми ценами и нарисованной
 * «фотографией»: буквой в кружке на цветном градиенте. Два первых молча
 * подменяли каталог, если у отеля меньше двух блюд со снимками; третье не
 * заменялось НИКОГДА — даже когда у отеля семьдесят позиций.
 *
 * Отличить выдумку от своего каталога на экране было нечем. Оператор настраивал
 * вид карточек, глядя на буквы «R» и «C», которых у гостя не будет никогда, а
 * оттенок нарисованной подложки спорил с палитрой, которую в этот момент и
 * подбирали.
 *
 * ТРИ ПРАВИЛА, ПО КОТОРЫМ ЭТО ТЕПЕРЬ УСТРОЕНО.
 *
 *   1. Сначала берётся НАСТОЯЩЕЕ. Есть позиции — показываются они, со своими
 *      названиями, ценами и снимками.
 *   2. Не хватает — показывается образец, И ОН НАЗВАН ОБРАЗЦОМ. Молчаливой
 *      подмены не осталось нигде: вызывающий получает `sample` и обязан
 *      сказать об этом на экране.
 *   3. У образца НЕТ ВЫДУМАННОЙ ФОТОГРАФИИ. Карточка витрины умеет свой вид
 *      без снимка (`KitImage` с запасной иконкой) — его и показываем. Рисовать
 *      «фотографию», которой у отеля нет, значит обещать вид, которого он не
 *      увидит.
 *
 * Названия образца берутся из переводов, а не зашиты по-английски: на русском
 * экране английское блюдо с рублёвой ценой — само по себе неправдоподобно.
 */

/** Что именно в показе ненастоящее. */
export interface PreviewSample {
  /** Список карточек собран из образца. */
  rows: boolean;
  /** Карточка позиции собрана из образца. */
  detail: boolean;
}

export interface PreviewCatalog {
  rows: MenuItem[];
  detail: ItemDetail;
  sample: PreviewSample;
}

/** Перевод переводимого поля: язык показа, иначе первый непустой. */
function pick(value: Translated | undefined, language: string): string {
  return (value?.[language] ?? Object.values(value ?? {})[0] ?? '') as string;
}

function rowFromItem(item: CmsItem, language: string): MenuItem {
  return {
    id: item.id,
    code: item.code,
    category_id: item.category_id,
    title: pick(item.title, language),
    description: pick(item.description, language),
    price: item.price,
    images: (item.images ?? []).map((image) => image.url).filter(Boolean),
    allergens: [],
    // Показ всегда рисует ДОСТУПНУЮ позицию: он про вид карточки, а не про
    // остатки. Иначе настройка бренда зависела бы от того, что сейчас в стопе.
    is_available: true,
    unavailable_reason: null,
  };
}

function detailFromItem(item: CmsItem, language: string): ItemDetail {
  return {
    ...rowFromItem(item, language),
    // Аллергены и маркеры у позиции есть только идентификаторами; тянуть ради
    // показа ещё два справочника значило бы гонять запросы за тем, что на вид
    // карточки почти не влияет. Пустой список честнее выдуманного.
    allergens: [],
    markers: [],
    modifier_groups: [],
  } as ItemDetail;
}

/**
 * Образцовые карточки — когда каталога ещё нет.
 *
 * Показ обязан работать на первой минуте отеля, до единой заведённой позиции:
 * оформление настраивают ДО наполнения. Но теперь образец назван образцом, и
 * цена у него в валюте отеля, а не выдуманная рублёвая.
 */
function sampleRows(t: (key: string) => string): MenuItem[] {
  return [
    {
      id: 'sample-1',
      code: 'sample-1',
      category_id: 'sample',
      title: t('brand.preview.sample.firstTitle'),
      description: t('brand.preview.sample.firstBody'),
      price: 120000,
      images: [],
      allergens: [],
      is_available: true,
      unavailable_reason: null,
    } as MenuItem,
    {
      id: 'sample-2',
      code: 'sample-2',
      category_id: 'sample',
      title: t('brand.preview.sample.secondTitle'),
      description: t('brand.preview.sample.secondBody'),
      price: 45000,
      images: [],
      allergens: [],
      is_available: true,
      unavailable_reason: null,
    } as MenuItem,
  ];
}

function sampleDetail(t: (key: string) => string): ItemDetail {
  const [first] = sampleRows(t);
  return { ...first, markers: [], modifier_groups: [] } as ItemDetail;
}

/**
 * Состав показа: настоящее, где оно есть, образец — где нет.
 *
 * Списку нужны ДВЕ карточки (рядом видно сетку и то, как соседствуют разные
 * названия), карточке позиции — одна. Поэтому состояния независимы: у отеля с
 * одной заведённой позицией список будет образцом, а карточка — настоящей.
 */
export function previewCatalog(
  items: CmsItem[],
  language: string,
  t: (key: string) => string,
): PreviewCatalog {
  // Со снимком — вперёд: показ про вид карточки, и карточка со снимком
  // показывает больше. Но позиция без снимка лучше выдуманной, поэтому
  // остальные идут следом, а не отбрасываются.
  const withPhoto = items.filter((item) => item.images?.length);
  const withoutPhoto = items.filter((item) => !item.images?.length);
  const ordered = [...withPhoto, ...withoutPhoto];

  const rowsAreReal = ordered.length >= 2;
  const detailIsReal = ordered.length >= 1;

  return {
    rows: rowsAreReal ? ordered.slice(0, 2).map((item) => rowFromItem(item, language)) : sampleRows(t),
    detail: detailIsReal ? detailFromItem(ordered[0], language) : sampleDetail(t),
    sample: { rows: !rowsAreReal, detail: !detailIsReal },
  };
}
