import type { ItemDetail, MenuItem } from '@/guest/api/types';

/**
 * Self-contained sample dishes for the brand preview. Photos are inline SVG data
 * URIs so the preview never depends on the network or on real catalog content.
 */
function foodSvg(emoji: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='240'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${hue},58%,68%)'/>` +
    `<stop offset='1' stop-color='hsl(${hue + 28},52%,42%)'/></linearGradient></defs>` +
    `<rect width='320' height='240' fill='url(#g)'/>` +
    `<text x='50%' y='54%' font-size='120' text-anchor='middle' dominant-baseline='middle'>${emoji}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const RIBEYE_IMG = foodSvg('🥩', 8);
const SALAD_IMG = foodSvg('🥗', 96);
const DESSERT_IMG = foodSvg('🍰', 330);

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
    flags: ['chef_choice', 'spicy'],
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
    flags: ['vegetarian'],
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
  flags: ['chef_choice', 'vegetarian'],
  allergens: ['egg', 'milk'],
  type: 'product',
  is_available: true,
  unavailable_reason: null,
  modifier_groups: [],
};
