/**
 * Formats an ISO datetime carrying a UTC offset down to its wall-clock `HH:MM`
 * AT THAT OFFSET — the hotel's local time — without depending on the browser TZ.
 * `serve_by` arrives with the hotel-TZ offset, so the guest always reads the time
 * the hotel means, wherever the guest's own device is set.
 */
export function serveByTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  let offsetMinutes: number;
  if (/z$/i.test(iso)) {
    offsetMinutes = 0;
  } else {
    const match = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
    offsetMinutes = match
      ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
      : -date.getTimezoneOffset();
  }
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
