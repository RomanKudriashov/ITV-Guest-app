import type { ItemDetail, MenuItem } from '@/guest/api/types';

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
