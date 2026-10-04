/**
 * СРОК — В ПОЯСЕ ОТЕЛЯ И С ДАТОЙ, ЕСЛИ НЕ СЕГОДНЯ (партия 30, п.46 бэклога).
 *
 * Трекер, страница заказа и полоса главной показывали только часы — для заказа
 * ко времени (не дальше суток) это было честно, но срок заявки на пятницу
 * читался «к 12:00» без дня. Один форматтер на три места: часы и дата — по
 * смещению, с которым сервер прислал время (это пояс ОТЕЛЯ), а не по поясу
 * телефона или компьютера, на котором смотрят.
 */

function offsetMinutes(iso: string, date: Date): number {
  if (/z$/i.test(iso)) return 0;
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  return match
    ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : -date.getTimezoneOffset();
}

/** «12:00» сегодня, «пт, 3 окт., 12:00» в другой день — по часам отеля. */
export function dueText(iso: string | null | undefined, language: string, now: number = Date.now()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const shift = offsetMinutes(iso, date) * 60_000;
  const wall = new Date(date.getTime() + shift);
  const today = new Date(now + shift);
  const clock = `${String(wall.getUTCHours()).padStart(2, '0')}:${String(wall.getUTCMinutes()).padStart(2, '0')}`;
  const sameDay =
    wall.getUTCFullYear() === today.getUTCFullYear() &&
    wall.getUTCMonth() === today.getUTCMonth() &&
    wall.getUTCDate() === today.getUTCDate();
  if (sameDay) return clock;
  try {
    const day = new Intl.DateTimeFormat(language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(wall);
    return `${day}, ${clock}`;
  } catch {
    return clock;
  }
}
