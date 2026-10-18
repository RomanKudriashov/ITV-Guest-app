/**
 * МЕСТА ПОКАЗА ФОТО ПО РОЛЯМ (партия 58в) — вместо реестра рамок `surfaces.ts`.
 *
 * Рамки больше нет: варианты режутся из целого оригинала (58а), а каждое место
 * кладёт фото по точке главного. Редактор поэтому показывает не «кадр», а все
 * места, где это фото увидит гость, — на 1440 и 390, тем же `KitImage`.
 *
 * РАЗМЕРЫ — ЗАМЕР, А НЕ НА ГЛАЗ: место в CSS-пикселях с машины разработчика
 * (замер 58б по `places.json`, демо-отели, 1440 и 390, DPR 1). Изменится
 * вёрстка витрины — правится здесь, редактор и предупреждение о слабом
 * оригинале пересчитаются сами.
 */
import type { KitImageFit } from '@/kit';

export type MediaRole = 'item' | 'info' | 'venue' | 'categoryCover' | 'background' | 'banner' | 'logo';

/** Ширина и высота места в CSS-пикселях. */
export type PlaceSize = readonly [number, number];

export interface Place {
  key: string;
  /** Ключ i18n: где именно это увидит гость. */
  labelKey: string;
  fit: KitImageFit;
  /** Место на 1440 (ПК) и 390 (телефон); null — на этой ширине места нет. */
  wide: PlaceSize | null;
  phone: PlaceSize | null;
}


const ITEM_CARD: Place = { key: 'card', labelKey: 'media.place.card', fit: 'fill', wide: [331, 146], phone: [169, 146] };
/**
 * Окно позиции (партия 58б, откат): на ПК фото колонкой слева — 44 % окна
 * 1040 (`itemCard.railWindow/railShare`), высота по тексту, не ниже 460; на
 * телефоне — сверху шторки. «Заполнить» по фокусу, как всё у гостя.
 */
const ITEM_WINDOW: Place = {
  key: 'window',
  labelKey: 'media.place.window',
  fit: 'fill',
  wide: [458, 600],
  phone: [388, 224],
};
const HOME_TILE: Place = { key: 'homeTile', labelKey: 'media.place.homeTile', fit: 'fill', wide: [509, 170], phone: [358, 132] };
const SECTION_HEADER: Place = { key: 'sectionHeader', labelKey: 'media.place.sectionHeader', fit: 'fill', wide: [1080, 360], phone: [390, 218] };

export const ROLE_PLACES: Record<MediaRole, readonly Place[]> = {
  item: [
    ITEM_CARD,
    { key: 'mosaic', labelKey: 'media.place.mosaic', fit: 'fill', wide: [252, 189], phone: [176, 132] },
    { key: 'mosaicLarge', labelKey: 'media.place.mosaicLarge', fit: 'fill', wide: [512, 386], phone: [358, 270] },
    ITEM_WINDOW,
    { key: 'search', labelKey: 'media.place.search', fit: 'fill', wide: [56, 56], phone: [56, 56] },
  ],
  info: [ITEM_CARD, ITEM_WINDOW],
  venue: [
    { key: 'venueHeader', labelKey: 'media.place.venueHeader', fit: 'fill', wide: [1080, 360], phone: [390, 214] },
    { key: 'venueTile', labelKey: 'media.place.venueTile', fit: 'fill', wide: [333, 190], phone: [358, 168] },
    HOME_TILE,
    { key: 'homeTileLarge', labelKey: 'media.place.homeTileLarge', fit: 'fill', wide: [509, 354], phone: [358, 266] },
  ],
  categoryCover: [SECTION_HEADER, HOME_TILE],
  background: [
    { key: 'backdrop', labelKey: 'media.place.backdrop', fit: 'fill', wide: [1440, 900], phone: [390, 844] },
    { key: 'homeHero', labelKey: 'media.place.homeHero', fit: 'fill', wide: [1080, 360], phone: [390, 252] },
    SECTION_HEADER,
  ],
  banner: [{ key: 'banner', labelKey: 'media.place.banner', fit: 'fill', wide: [1032, 200], phone: [358, 150] }],
  // Логотип отдаётся как загружен и вписан целиком: точки главного у него нет.
  logo: [],
};

/** Форма миниатюры в загрузчике: первое место роли на телефоне. */
export function roleThumbRatio(role: MediaRole): number {
  const first = ROLE_PLACES[role][0]?.phone;
  return first ? first[0] / first[1] : role === 'logo' ? 1 : 4 / 3;
}

/** Размер места на ширине экрана с учётом формы фото (окно позиции на ПК). */
export function placeSize(place: Place, screen: 'wide' | 'phone', photoRatio: number): PlaceSize | null {
  void photoRatio;
  return place[screen];
}

/** DPR, под который считается «хватает ли оригинала»: телефон и ноутбук — 2. */
export const CHECK_DPR = 2;

export interface PlaceCheck {
  /** Доля кадра, видимая в месте (как `data-visible-share` у KitImage) — подписью. */
  share: number;
  /** Ширина оригинала, нужная месту при DPR 2. */
  needWidth: number;
  /** Растяжение файла при DPR 2 (>1 — источника не хватает). */
  stretch: number;
  /**
   * Красная метка — ТОЛЬКО «оригинала не хватает» (партия 58б, откат). Режима
   * «целиком» у гостя больше нет: каждое место заполняется по точке главного,
   * и доля кадра — справка, а не ошибка.
   */
  bad: boolean;
}

/**
 * Разбор места для фото `w×h`. Та же математика, что у `KitImage` (доля
 * кадра) и у замера 58а/58б (растяжение при DPR 2). Место всегда заполняется.
 */
export function checkPlace(_fit: KitImageFit, size: PlaceSize, w: number, h: number): PlaceCheck {
  const [pw, ph] = size;
  const photo = w / h;
  const box = pw / ph;
  const share = Math.min(box / photo, photo / box);
  const needWidth = Math.ceil(Math.max(pw, ph * photo) * CHECK_DPR);
  const stretch = Math.round((needWidth / w) * 100) / 100;
  return { share, needWidth, stretch, bad: stretch > 1 };
}

/**
 * Ширина оригинала, которой хватает САМОМУ КРУПНОМУ месту роли (при DPR 2) —
 * для предупреждения о слабом оригинале при загрузке. Считается из мест, а не
 * константой: поменяются места — поменяется и порог.
 */
export function roleNeedWidth(role: MediaRole, w: number, h: number): number {
  let need = 0;
  for (const place of ROLE_PLACES[role]) {
    for (const screen of ['wide', 'phone'] as const) {
      const size = placeSize(place, screen, w / h);
      if (size) need = Math.max(need, checkPlace(place.fit, size, w, h).needWidth);
    }
  }
  return need;
}
