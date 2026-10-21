/**
 * СЛОВА ВМЕСТО КОДОВ (партия 62, второй заход): в интерфейсе нет ни
 * `Europe/Moscow`, ни `RUB`, ни `English` — только то, что человек
 * понимает без справки.
 */

const TZ: Record<string, string> = {
  'Europe/Kaliningrad': 'Калининград',
  'Europe/Moscow': 'Москва',
  'Europe/Samara': 'Самара',
  'Asia/Yekaterinburg': 'Екатеринбург',
  'Asia/Omsk': 'Омск',
  'Asia/Novosibirsk': 'Новосибирск',
  'Asia/Krasnoyarsk': 'Красноярск',
  'Asia/Irkutsk': 'Иркутск',
  'Asia/Vladivostok': 'Владивосток',
  'Europe/Istanbul': 'Стамбул',
  'Asia/Dubai': 'Дубай',
};

/** «Москва, UTC+3». */
export function timezoneLabel(zone: string): string {
  let offset = '';
  try {
    const part = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    offset = (part ?? '').replace('GMT', 'UTC');
  } catch {
    offset = '';
  }
  return `${TZ[zone] ?? zone.split('/').pop()?.replace(/_/g, ' ')}${offset ? `, ${offset}` : ''}`;
}

const CURRENCY: Record<string, string> = {
  RUB: 'Российский рубль, ₽',
  EUR: 'Евро, €',
  USD: 'Доллар США, $',
  AED: 'Дирхам ОАЭ',
  CNY: 'Китайский юань, ¥',
  KZT: 'Казахстанский тенге, ₸',
};
export const currencyLabel = (code: string) => CURRENCY[code] ?? code;

const LANGUAGE: Record<string, string> = {
  ru: 'Русский',
  en: 'Английский',
  ar: 'Арабский',
  zh: 'Китайский',
  de: 'Немецкий',
  fr: 'Французский',
  tr: 'Турецкий',
};
export const languageLabel = (code: string) => LANGUAGE[code] ?? code;

export function dateTime(at: string): string {
  return new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}
