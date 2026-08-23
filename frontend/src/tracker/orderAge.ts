import type { TFunction } from 'i18next';

/**
 * ВОЗРАСТ ЗАДАЧИ НА ДОСКЕ — СЛОВАМИ, А НЕ ЧИСЛОМ МИНУТ.
 *
 * Карточка печатала сырое `waiting_minutes`: «429 мин», а на боевом стенде
 * доходило до «89700 мин». Это не долгое ожидание, это отказ отвечать на
 * вопрос — повар обязан был делить в уме на шестьдесят и на двадцать четыре,
 * чтобы понять, что заказ висит с позапрошлой недели.
 *
 * Четыре ступени, каждая отвечает на свой вопрос:
 *
 *   < 60 мин   «12 минут»      — сколько ждёт прямо сейчас, главный случай;
 *   < 24 ч     «2 ч 15 мин»    — ещё сегодня, но уже долго;
 *   вчера      «вчера, 14:20»  — вчерашняя смена, счёт минут потерял смысл;
 *   раньше     «3 августа»     — забытая задача, важна дата, а не длительность.
 *
 * ВСЁ ЧЕРЕЗ ЛОКАЛИЗАЦИЮ. Ни одна из этих строк не собирается склейкой в коде:
 * у русского три формы множественного числа, у арабского шесть, у китайского
 * одна, а порядок «2 ч 15 мин» в другом языке может оказаться иным. Код
 * передаёт числа, слова выбирает перевод.
 */

/** Минут в часе и часов в сутках — чтобы ступени читались, а не считались. */
const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * MIN_PER_HOUR;

export function formatClock(iso: string | null | undefined, language: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return '';
  }
}

/**
 * Дата без года, а с годом — только если год чужой.
 *
 * «3 августа» на доске понятно всем; «3 августа 2026 г.» на второй день работы
 * читается как канцелярия. Но заказ из прошлого года без года — это уже ложь,
 * поэтому год появляется ровно тогда, когда он что-то значит.
 */
function formatDate(date: Date, language: string, now: Date): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  try {
    return new Intl.DateTimeFormat(language, {
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Сколько задача ждёт — одной фразой.
 *
 * `minutes` — то, что посчитал СЕРВЕР (`waiting_minutes`). Пересчитывать возраст
 * на клиенте нельзя: у отеля своя таймзона, а у планшета на кухне часы бывают
 * какие угодно, и «ждёт минус три часа» мы уже видели на другом экране.
 * `createdAt` нужен только двум последним ступеням — там показывается момент,
 * а не длительность, и момент обязан быть настоящим.
 */
export function formatAge(
  minutes: number,
  createdAt: string | null | undefined,
  t: TFunction,
  language: string,
  now: Date = new Date(),
): string {
  const value = Math.max(0, Math.round(minutes));

  if (value < MIN_PER_HOUR) return t('tracker.age.minutes', { count: value });

  if (value < MIN_PER_DAY) {
    const hours = Math.floor(value / MIN_PER_HOUR);
    const rest = value % MIN_PER_HOUR;
    // Ровный час не тащит за собой «0 мин»: «3 ч» честнее и короче «3 ч 0 мин».
    return rest === 0
      ? t('tracker.age.hours', { count: hours })
      : t('tracker.age.hoursMinutes', { hours, minutes: rest });
  }

  // Дальше суток длительность перестаёт помогать: важно КОГДА, а не СКОЛЬКО.
  const created = createdAt ? new Date(createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) {
    // Момента нет — падаем на дни, но всё равно словами, а не минутами.
    return t('tracker.age.days', { count: Math.floor(value / MIN_PER_DAY) });
  }

  if (isYesterday(created, now)) {
    return t('tracker.age.yesterday', { time: formatClock(createdAt, language) });
  }
  return formatDate(created, language, now);
}

/** Вчера — по календарю, а не «минус 24 часа»: в 00:30 «вчера» началось час назад. */
function isYesterday(date: Date, now: Date): boolean {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  );
}

/**
 * «Просрочен на 8 минут» — насколько, а не просто «да».
 *
 * Красный чип без величины одинаково выглядел у заказа, опоздавшего на минуту,
 * и у забытого на двое суток. Повару это разные новости.
 *
 * Величину считает СЕРВЕР (`overdue_minutes`): порог живёт в настройке точки, и
 * вычитать его на клиенте значило бы завести второе место, где записано, что
 * такое просрочка.
 */
export function formatOverdue(overdueMinutes: number, t: TFunction): string {
  return t('tracker.card.overdueBy', { duration: formatOverdueSpan(overdueMinutes, t) });
}

/**
 * Длительность просрочки. Здесь НЕ падаем на дату: «просрочен на 3 августа» —
 * бессмыслица. Дальше суток говорим днями.
 */
function formatOverdueSpan(minutes: number, t: TFunction): string {
  const value = Math.max(0, Math.round(minutes));
  if (value < MIN_PER_HOUR) return t('tracker.age.minutes', { count: value });
  if (value < MIN_PER_DAY) {
    const hours = Math.floor(value / MIN_PER_HOUR);
    const rest = value % MIN_PER_HOUR;
    return rest === 0
      ? t('tracker.age.hours', { count: hours })
      : t('tracker.age.hoursMinutes', { hours, minutes: rest });
  }
  return t('tracker.age.days', { count: Math.floor(value / MIN_PER_DAY) });
}
