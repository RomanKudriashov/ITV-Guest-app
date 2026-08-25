/**
 * КТО МЫ ПО АДРЕСУ: корень платформы, отель или машина разработчика.
 *
 * Схема адресов принята такая:
 *
 *   <корень>              — лендинг платформы
 *   <корень>/admin        — наша консоль
 *   <отель>.<корень>      — гостевое приложение отеля
 *   <отель>.<корень>/admin — CMS этого отеля
 *
 * Роль считается ИЗ ИМЕНИ ХОСТА, без запроса к серверу. Лендинг обязан
 * открываться нулём запросов к API, а «спросить у бэкенда, чей это адрес»
 * означало бы и запрос, и мигание экраном на время ответа.
 *
 * Базовый домен приходит сборкой (`VITE_APP_DOMAIN`) из той же переменной
 * `APP_DOMAIN`, что задаёт домен бэкенду. Одна переменная на обе стороны —
 * иначе они разъедутся, и разъедутся молча.
 *
 * ПУСТОЙ БАЗОВЫЙ ДОМЕН — ЭТО РЕЖИМ, А НЕ ОШИБКА. На машине разработчика домена
 * нет: там `localhost:5183`, и делить его на «корень» и «отель» нечем. В этом
 * режиме приложение ведёт себя как раньше: гость в корне, CMS на `/cms`,
 * консоль на `/admin`. Так продолжают работать сотня существующих проверок,
 * писавшихся до схемы, а сама схема проверяется на именах `guest.localhost` и
 * `crystal.guest.localhost` — они разрешаются в петлю и в браузере, и в
 * контейнере.
 */

export type HostRole =
  /** Корень платформы: лендинг и наша консоль. */
  | 'platform'
  /** Адрес отеля: гость и CMS этого отеля. */
  | 'hotel'
  /** Домена нет — старое поведение одного хоста (dev). */
  | 'single';

/** Хосты машины разработчика: делить их на роли нечем и незачем. */
function isDeveloperHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  // mDNS-имя машины (`MacBook-Pro-Oleg.local`) — стенд открывают с телефона.
  if (host.endsWith('.local')) return true;
  // Голый IP: стенд до появления домена живёт именно так.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Роль адреса.
 *
 * Порядок проверок важен: базовый домен сверяется ПЕРВЫМ, потому что
 * `guest.localhost` — это базовый домен разработки, а не «localhost», и
 * `crystal.guest.localhost` кончается на `.localhost`, но это отель.
 */
export function hostRole(hostname: string, baseDomain: string): HostRole {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '').split(':')[0];
  const base = (baseDomain || '').toLowerCase().replace(/^\.|\.$/g, '');

  if (!base) return 'single';
  if (host === base || host === `www.${base}`) return 'platform';
  if (host.endsWith(`.${base}`)) return 'hotel';
  if (isDeveloperHost(host)) return 'single';
  // Чужой домен при заданном базовом — это кастомный домен отеля: поле
  // `Hotel.custom_domain` существует, и такой адрес обязан вести к отелю, а не
  // к нашей консоли.
  return 'hotel';
}

/** Базовый домен, как его знает сборка. Пусто — режим одного хоста. */
export const APP_DOMAIN: string = (import.meta.env.VITE_APP_DOMAIN as string | undefined) ?? '';

export const HOST_ROLE: HostRole = hostRole(
  typeof window === 'undefined' ? '' : window.location.hostname,
  APP_DOMAIN,
);

/**
 * Корень CMS отеля НА ЭТОМ адресе.
 *
 * На адресе отеля панель живёт в `/admin`: для администратора отеля это его
 * админка, и второго `/admin` на этом хосте нет — наша консоль сюда не
 * пускается вовсе. В режиме одного хоста `/admin` занят консолью, поэтому
 * панель остаётся на `/cms`.
 */
export const CMS_ROOT: string = HOST_ROLE === 'hotel' ? '/admin' : '/cms';

/** Путь внутри CMS: `cmsPath('/services')` → `/admin/services` или `/cms/services`. */
export function cmsPath(tail = ''): string {
  const suffix = tail.startsWith('/') ? tail : tail ? `/${tail}` : '';
  return `${CMS_ROOT}${suffix}`;
}

/**
 * Канонический путь раздела (`/cms/...`, как его отдаёт сервер в навигации) —
 * в корень, на котором CMS живёт здесь.
 *
 * Сервер про хост клиента не знает и знать не должен: он отдаёт КАНОНИЧЕСКИЙ
 * адрес раздела, а куда его положить — знание клиента, у которого этот хост
 * перед глазами.
 */
export function toCmsRoot(canonical: string): string {
  return canonical.startsWith('/cms') ? cmsPath(canonical.slice('/cms'.length)) : canonical;
}
