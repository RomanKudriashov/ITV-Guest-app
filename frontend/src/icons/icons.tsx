import { createIcon } from './AppIcon';

/**
 * The redesign-v2 monochrome line-icon set. Each icon is a React component built
 * from `createIcon` (24×24 grid, single stroke width, `stroke="currentColor"`).
 * A few small marks (dots) use `fill="currentColor"` so they still recolor from
 * the inherited text color — never a color literal.
 *
 * Prefer these over `@mui/icons-material` inside the redesign-v2 kit.
 */

/* ── Storefront sections / offering types ─────────────────────────────────── */

export const IconRestaurant = createIcon(
  'restaurant',
  <>
    <path d="M6 3v5a2.5 2.5 0 0 0 5 0V3" />
    <path d="M8.5 8v13" />
    <path d="M17 3c-2 3-2 8 0 11" />
    <path d="M17 14v7" />
  </>,
);

export const IconServices = createIcon(
  'services',
  <>
    <path d="M3 18h18" />
    <path d="M5 18a7 7 0 0 1 14 0" />
    <path d="M12 8V6" />
    <path d="M10.5 6h3" />
  </>,
);

export const IconSlots = createIcon(
  'slots',
  <>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 9.5h16" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
  </>,
);

export const IconInfo = createIcon(
  'info',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="7.75" r="0.4" fill="currentColor" />
  </>,
);

export const IconBag = createIcon(
  'bag',
  <>
    <path d="M6 8h12l-1 12H7z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </>,
);

/* ── Dietary flags & allergens ────────────────────────────────────────────── */

export const IconVegan = createIcon(
  'vegan',
  <>
    <path d="M20 4C9 4 4 9 5 20 16 20 21 15 20 4Z" />
    <path d="M12 12 6.5 17.5" />
  </>,
);

export const IconVegetarian = createIcon(
  'vegetarian',
  <>
    <path d="M12 21v-7" />
    <path d="M12 14c-4 0-6-2-6-6 4 0 6 2 6 6z" />
    <path d="M12 14c4 0 6-2 6-6-4 0-6 2-6 6z" />
  </>,
);

export const IconSpicy = createIcon(
  'spicy',
  <path d="M12 3c2.5 3.5 4 6 4 9.5A4 4 0 0 1 8 12.5c0-1.5.8-2.8 1.8-3.6.2 1.6 1 2.6 2 2.9C11.5 8.8 11 6 12 3z" />,
);

export const IconGlutenFree = createIcon(
  'gluten-free',
  <>
    <path d="M12 21V8" />
    <path d="M12 12c-2 0-3.5-1.5-3.5-3.5C10.5 8.5 12 10 12 12z" />
    <path d="M12 12c2 0 3.5-1.5 3.5-3.5C13.5 8.5 12 10 12 12z" />
    <path d="M12 16c-2 0-3.5-1.5-3.5-3.5C10.5 12.5 12 14 12 16z" />
    <path d="M5 5l14 14" />
  </>,
);

export const IconLactoseFree = createIcon(
  'lactose-free',
  <>
    <path d="M8 4h8l-1 16H9z" />
    <path d="M7.5 8h9" />
    <path d="M5 5l14 14" />
  </>,
);

export const IconNuts = createIcon(
  'nuts',
  <>
    <circle cx="9" cy="9" r="5" />
    <circle cx="15" cy="15" r="5" />
  </>,
);

export const IconSeafood = createIcon(
  'seafood',
  <>
    <path d="M3 12c4-6 12-6 15 0-3 6-11 6-15 0z" />
    <path d="M18 12l3-3v6z" />
    <circle cx="7.5" cy="11" r="0.4" fill="currentColor" />
  </>,
);

export const IconHalal = createIcon(
  'halal',
  <path d="M17 4a8 8 0 1 0 0 16 6.5 6.5 0 0 1 0-16z" />,
);

export const IconEgg = createIcon(
  'egg',
  <path d="M12 3c-4 0-6.5 6-6.5 10a6.5 6.5 0 0 0 13 0c0-4-2.5-10-6.5-10z" />,
);

export const IconMilk = createIcon(
  'milk',
  <>
    <path d="M8 4h8l-1 16H9z" />
    <path d="M7.5 8h9" />
  </>,
);

/* ── Actions ──────────────────────────────────────────────────────────────── */

export const IconAdd = createIcon(
  'add',
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const IconMinus = createIcon('minus', <path d="M5 12h14" />);

export const IconEdit = createIcon(
  'edit',
  <>
    <path d="M5 16.5 15.5 6l3 3L8 19.5l-4 1z" />
    <path d="M14 7.5l3 3" />
  </>,
);

export const IconDelete = createIcon(
  'delete',
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6.5 7l1 13h9l1-13" />
  </>,
);

export const IconBack = createIcon(
  'back',
  <>
    <path d="M20 12H4" />
    <path d="M10 6l-6 6 6 6" />
  </>,
);

export const IconClose = createIcon(
  'close',
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </>,
);

export const IconSearch = createIcon(
  'search',
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </>,
);

export const IconFilter = createIcon(
  'filter',
  <path d="M4 5h16l-6 8v6l-4-2v-4z" />,
);

export const IconSort = createIcon(
  'sort',
  <>
    <path d="M7 4v16" />
    <path d="M4 17l3 3 3-3" />
    <path d="M14 6h6" />
    <path d="M14 11h4" />
    <path d="M14 16h2" />
  </>,
);

export const IconShare = createIcon(
  'share',
  <>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="M8.2 10.8 15.8 6.6" />
    <path d="M8.2 13.2 15.8 17.4" />
  </>,
);

export const IconDownload = createIcon(
  'download',
  <>
    <path d="M12 4v10" />
    <path d="M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </>,
);

export const IconMore = createIcon(
  'more',
  <>
    <circle cx="12" cy="5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none" />
  </>,
);

export const IconCheck = createIcon('check', <path d="M5 13l4 4L19 7" />);

/* ── Statuses ─────────────────────────────────────────────────────────────── */

export const IconStatusNew = createIcon(
  'status-new',
  <path d="M12 3l2.2 5.8L20 9l-4.5 3.6L17 19l-5-3-5 3 1.5-6.4L4 9l5.8-.2z" />,
);

export const IconStatusAccepted = createIcon(
  'status-accepted',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </>,
);

export const IconStatusPreparing = createIcon(
  'status-preparing',
  <>
    <path d="M5 12h13v3a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
    <path d="M3 13h2" />
    <path d="M18 13h2" />
    <path d="M9 4c-1 1 1 2 0 3.5" />
    <path d="M13 4c-1 1 1 2 0 3.5" />
  </>,
);

export const IconStatusReady = createIcon(
  'status-ready',
  <>
    <path d="M6 16h12l-1.5-2v-3a4.5 4.5 0 0 0-9 0v3z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </>,
);

export const IconStatusDone = createIcon(
  'status-done',
  <>
    <path d="M3 12.5l3.5 3.5L14 7" />
    <path d="M9 15.5l1 1.5L21 7" />
  </>,
);

export const IconStatusCancelled = createIcon(
  'status-cancelled',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6" />
    <path d="M15 9l-6 6" />
  </>,
);

/* ── Navigation ───────────────────────────────────────────────────────────── */

export const IconHome = createIcon(
  'home',
  <>
    <path d="M4 11l8-7 8 7" />
    <path d="M6 10v9h12v-9" />
    <path d="M10 19v-5h4v5" />
  </>,
);

export const IconOrders = createIcon(
  'orders',
  <>
    <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
  </>,
);

export const IconChat = createIcon(
  'chat',
  <>
    <path d="M5 5h14v10H9l-4 4z" />
    <circle cx="9" cy="10" r="0.4" fill="currentColor" />
    <circle cx="12" cy="10" r="0.4" fill="currentColor" />
    <circle cx="15" cy="10" r="0.4" fill="currentColor" />
  </>,
);

export const IconAnalytics = createIcon(
  'analytics',
  <>
    <path d="M4 20h16" />
    <path d="M6 20V11" />
    <path d="M12 20V4" />
    <path d="M18 20v-7" />
  </>,
);

export const IconRooms = createIcon(
  'rooms',
  <>
    <path d="M6 21V4a1 1 0 0 1 1-1h8v18" />
    <path d="M6 21h12" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </>,
);

export const IconStaff = createIcon(
  'staff',
  <>
    <circle cx="9" cy="8" r="3" />
    <path d="M4 20c0-3 2.2-5 5-5s5 2 5 5" />
    <path d="M15 5.2a3 3 0 0 1 0 5.6" />
    <path d="M16 15.2c1.8.6 3 2.3 3 4.8" />
  </>,
);

export const IconBrand = createIcon(
  'brand',
  <>
    <path d="M12 3a9 9 0 1 0 3 17.5c-1-1 0-3 1.8-3H18a3 3 0 0 0 3-3C21 7.6 17 3 12 3z" />
    <circle cx="8.5" cy="11" r="0.5" fill="currentColor" />
    <circle cx="12" cy="8" r="0.5" fill="currentColor" />
    <circle cx="15.5" cy="10" r="0.5" fill="currentColor" />
  </>,
);

/* ── Badges ───────────────────────────────────────────────────────────────── */

export const IconHit = createIcon(
  'hit',
  <path d="M12 3c1.5 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.2.5-2 1.2-2.7C9.5 9.8 10.5 10 11 11c.8-2.8-.5-5.5 1-8z" />,
);

export const IconChefChoice = createIcon(
  'chef-choice',
  <>
    <path d="M7 14h10v5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
    <path d="M7 14a3.5 3.5 0 0 1-1-6.5 3.5 3.5 0 0 1 6.5-2 3.5 3.5 0 0 1 6.5 2A3.5 3.5 0 0 1 17 14z" />
    <path d="M9 17h6" />
  </>,
);

/* ── Room controls ────────────────────────────────────────────────────────── */

export const IconDimmer = createIcon(
  'dimmer',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2" />
    <path d="M12 19v2" />
    <path d="M3 12h2" />
    <path d="M19 12h2" />
    <path d="M5.6 5.6l1.4 1.4" />
    <path d="M17 17l1.4 1.4" />
    <path d="M18.4 5.6L17 7" />
    <path d="M7 17l-1.4 1.4" />
  </>,
);

export const IconCurtain = createIcon(
  'curtain',
  <>
    <path d="M4 5h16" />
    <path d="M6 5v14" />
    <path d="M18 5v14" />
    <path d="M6 19c1.5-2 3-2 3-7s-1.5-5-1.5-7" />
    <path d="M18 19c-1.5-2-3-2-3-7s1.5-5 1.5-7" />
  </>,
);

export const IconThermostat = createIcon(
  'thermostat',
  <>
    <path d="M10 13.5V6.5a2 2 0 0 1 4 0v7a4 4 0 1 1-4 0z" />
    <path d="M12 9v5.5" />
    <circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none" />
  </>,
);

export const IconSwitch = createIcon(
  'switch',
  <>
    <rect x="3" y="8" width="18" height="8" rx="4" />
    <circle cx="16" cy="12" r="2.4" fill="currentColor" stroke="none" />
  </>,
);

export const IconScene = createIcon(
  'scene',
  <>
    <path d="M11 4l1.5 3.6L16 9l-3.5 1.4L11 14l-1.5-3.6L6 9l3.5-1.4z" />
    <path d="M17.5 14l.8 1.8L20 16.6l-1.7.8-.8 1.8-.8-1.8L15 16.6l1.7-.8z" />
  </>,
);

export const IconLock = createIcon(
  'lock',
  <>
    <rect x="6" y="11" width="12" height="9" rx="1.5" />
    <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    <path d="M12 15v2" />
  </>,
);

export const IconWifi = createIcon(
  'wifi',
  <>
    <path d="M4 9a13 13 0 0 1 16 0" />
    <path d="M7 12.5a8 8 0 0 1 10 0" />
    <path d="M9.8 16a4 4 0 0 1 4.4 0" />
    <circle cx="12" cy="19" r="0.5" fill="currentColor" />
  </>,
);

export const IconRunning = createIcon(
  'running',
  <path d="M12 4a8 8 0 1 1-8 8" />,
);

export const IconOffline = createIcon(
  'offline',
  <>
    <path d="M4 9a13 13 0 0 1 16 0" />
    <path d="M7 12.5a8 8 0 0 1 10 0" />
    <circle cx="12" cy="19" r="0.5" fill="currentColor" />
    <path d="M4 4l16 16" />
  </>,
);
