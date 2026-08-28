import type { ItemDetail, MenuItem } from '@/guest/api/types';
import type { Item as CmsItem, Translated } from '@/api/types';

/**
 * Self-contained sample dishes for the brand preview. Photos are inline SVG data
 * URIs so the preview never depends on the network or on real catalog content.
 *
 * The placeholder is a NON-EMOJI graphic: a gradient plate with a monogram
 * initial and a couple of geometric marks — a neutral stand-in for a real photo
 * (the storefront always shows the operator's own images). The `hue` only tints
 * this throwaway sample art; it is not part of the brand token system.
 */
function dishSvg(monogram: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='240'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${hue},58%,68%)'/>` +
    `<stop offset='1' stop-color='hsl(${hue + 28},52%,42%)'/></linearGradient></defs>` +
    `<rect width='320' height='240' fill='url(#g)'/>` +
    `<circle cx='160' cy='120' r='78' fill='none' stroke='rgba(255,255,255,0.35)' stroke-width='2'/>` +
    `<circle cx='160' cy='120' r='58' fill='rgba(255,255,255,0.14)'/>` +
    `<text x='50%' y='53%' font-family='Onest, system-ui, sans-serif' font-size='96' ` +
    `fill='rgba(255,255,255,0.92)' text-anchor='middle' dominant-baseline='middle'>${monogram}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const RIBEYE_IMG = dishSvg('R', 8);
const SALAD_IMG = dishSvg('C', 96);
const DESSERT_IMG = dishSvg('P', 330);

/**
 * НАСТОЯЩИЕ БЛЮДА ОТЕЛЯ вместо образцов — если они уже заведены.
 *
 * Монограмма на цветном прямоугольнике не даёт судить о бренде: оператор
 * настраивает вид карточек, а видит буквы «R» и «C», которых у гостя не будет
 * никогда. Хуже того, у заглушки свой оттенок, и он спорит с палитрой, которую
 * в этот момент и подбирают.
 *
 * Образцы остаются для отеля, у которого каталога ещё нет: показ обязан
 * работать и на первой минуте, до единой загруженной фотографии.
 */
export function rowsFromItems(items: CmsItem[], language: string): MenuItem[] {
  const withPhoto = items.filter((item) => item.images?.length);
  if (withPhoto.length < 2) return PREVIEW_ROWS;
  const pick = (value: Translated | undefined): string =>
    (value?.[language] ?? Object.values(value ?? {})[0] ?? '') as string;
  return withPhoto.slice(0, 2).map((item) => ({
    id: item.id,
    code: item.code,
    category_id: item.category_id,
    title: pick(item.title),
    description: pick(item.description),
    price: item.price,
    images: item.images.map((image) => image.url).filter(Boolean),
    allergens: [],
    // Показ всегда рисует доступную позицию: он про ВИД карточки, а не про
    // остатки. Иначе настройка бренда зависела бы от того, что сейчас в стопе.
    is_available: true,
    unavailable_reason: null,
  }));
}

/** Rows for the menu-list part of the preview. */
export const PREVIEW_ROWS: MenuItem[] = [
  {
    id: 'preview-ribeye',
    code: 'ribeye',
    category_id: 'preview',
    title: 'Ribeye Steak',
    description: 'Dry-aged, grilled to your liking, with roasted vegetables.',
    price: 249000,
    images: [RIBEYE_IMG],
    allergens: [],
    type: 'product',
    is_available: true,
    unavailable_reason: null,
  },
  {
    id: 'preview-caesar',
    code: 'caesar',
    category_id: 'preview',
    title: 'Caesar Salad',
    description: 'Romaine, parmesan, garlic croutons, house dressing.',
    price: 89000,
    images: [SALAD_IMG],
    allergens: [],
    type: 'product',
    is_available: true,
    unavailable_reason: null,
  },
];

/** Item used for the card / sheet body part of the preview. */
export const PREVIEW_DETAIL: ItemDetail = {
  id: 'preview-dessert',
  code: 'pavlova',
  category_id: 'preview',
  title: 'Vanilla Pavlova',
  description:
    'Crisp meringue, whipped vanilla cream and fresh seasonal berries — the house signature.',
  price: 64000,
  images: [DESSERT_IMG],
  allergens: [
    { code: 'eggs', title: 'Eggs' },
    { code: 'milk', title: 'Milk' },
  ],
  markers: [{ code: 'vegetarian', title: 'Vegetarian' }],
  type: 'product',
  is_available: true,
  unavailable_reason: null,
  modifier_groups: [],
};
