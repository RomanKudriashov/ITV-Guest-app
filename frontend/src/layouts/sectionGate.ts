/**
 * ОХРАНА РАЗДЕЛОВ ПАНЕЛИ ПО ПРЯМОМУ АДРЕСУ (партия 31, DEV-07 QA).
 *
 * Пункт меню прятался, а адрес — нет: управляющая СПА по прямой ссылке на
 * «Настройки» получала полуживой экран с «Не удалось загрузить», повар — до
 * 12 ответов 403 в консоли. Право на раздел знает сервер — это его ответ
 * `/cms/navigation`; здесь лишь решается, монтировать ли экран, пока ответа
 * нет, и что показать, если раздела в ответе нет. Серверные 403 остаются как
 * были — это вторая, настоящая стена.
 */

/** Разделы, которые меню выдаёт по правам. Остальные адреса панели не охраняются. */
const GATED = new Set([
  'dashboard',
  'notifications',
  'orders',
  'reviews',
  'services',
  'rooms',
  'staff',
  'room-control',
  'brand',
  'marketing',
  'analytics',
  'settings',
  'dictionaries',
  'payments',
  'pms',
  'mobile-key',
]);

/** Редакторы меню живут внутри раздела «Сервисы». */
const ALIASES: Record<string, string> = { menu: 'services' };

/** Раздел адреса: первый сегмент после корня панели; `null` — не раздел. */
export function sectionOf(pathname: string, cmsRoot: string): string | null {
  if (!pathname.startsWith(`${cmsRoot}/`)) return null;
  const head = pathname.slice(cmsRoot.length + 1).split('/')[0];
  const section = ALIASES[head] ?? head;
  return GATED.has(section) ? section : null;
}

/** Разделы, которые сервер выдал пользователю (`/cms/settings` → `settings`). */
export function allowedSections(groups: Array<{ items: Array<{ to?: string | null; key: string }> }>): Set<string> {
  const allowed = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      const to = item.to ?? '';
      if (to.startsWith('/cms/')) allowed.add(to.slice('/cms/'.length).split('/')[0]);
    }
  }
  return allowed;
}
