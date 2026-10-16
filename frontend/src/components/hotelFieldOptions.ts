import type { SelectOption } from './SelectField';

/**
 * ВАРИАНТЫ ДЛЯ ПОЛЕЙ ОТЕЛЯ: пояс, валюта, языки (партия 54).
 *
 * Коды — с сервера (`/platform/reference/hotel-fields`, CMS — свои
 * `timezone_options`), подписи — здесь, средствами браузера (`Intl`), на языке
 * интерфейса. Одни и те же функции у NaviRoom Control и у CMS: пояс в обоих
 * местах читается одинаково — «Europe/Moscow (UTC+3)».
 */

/** «UTC+3», «UTC+5:30», «UTC−3:30», «UTC» — смещение зоны на сегодня. */
export function utcOffset(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    const match = part?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 'UTC';
    const [, sign, hours, minutes] = match;
    const h = String(Number(hours));
    return `UTC${sign === '-' ? '−' : '+'}${minutes === '00' ? h : `${h}:${minutes}`}`;
  } catch {
    return '';
  }
}

export function timezoneOptions(names: ReadonlyArray<string>): SelectOption[] {
  const now = new Date();
  return names.map((name) => {
    const offset = utcOffset(name, now);
    return { value: name, label: offset ? `${name} (${offset})` : name };
  });
}

export function currencyOptions(codes: ReadonlyArray<string>, language: string): SelectOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([language], { type: 'currency' });
  } catch {
    names = null;
  }
  return codes.map((code) => {
    const title = names?.of(code);
    return { value: code, label: title && title !== code ? `${code} — ${title}` : code };
  });
}

/** Язык — своим именем: «Русский», «English», «العربية», «中文». */
export function languageOptions(codes: ReadonlyArray<string>): SelectOption[] {
  return codes.map((code) => {
    let title = code.toUpperCase();
    try {
      const own = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      if (own) title = own.charAt(0).toLocaleUpperCase(code) + own.slice(1);
    } catch {
      /* старый браузер — оставляем код */
    }
    return { value: code, label: title, secondary: code };
  });
}
