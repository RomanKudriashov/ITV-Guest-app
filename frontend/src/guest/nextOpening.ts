/**
 * Когда позиция или заведение станет доступно В СЛЕДУЮЩИЙ РАЗ.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ПОДСТАНОВКА ВРЕМЕНИ. Витрина показывала
 * «с 07:00» — только час. В полдень, когда окно сырников уже закрылось, это
 * читается как «откроются в семь», хотя ближайшие семь утра — завтра, а на
 * сегодня их уже нет. Гость ждёт того, чего не будет.
 *
 * День считает СЕРВЕР и присылает моментом (`available_at`): у гостя в
 * телефоне может быть другая таймзона, и «сегодня» по его часам — не то же
 * «сегодня», что у отеля.
 *
 * Возвращаем не строку, а разобранный ответ: подпись собирает вызывающий на
 * своём языке, включая правое письмо.
 */
export type NextOpening =
  | { kind: 'today'; time: string }
  | { kind: 'tomorrow'; time: string }
  | { kind: 'later'; time: string; at: Date }
  /** Ближайшего открытия нет вовсе: расписание пустое. */
  | { kind: 'never' }
  /** Сервер прислал только час, дня не знаем — говорим осторожно. */
  | { kind: 'unknown'; time: string };

export function nextOpening(
  availableFrom: string | null | undefined,
  availableAt: string | null | undefined,
  now: Date = new Date(),
): NextOpening | null {
  if (!availableFrom && !availableAt) return null;
  if (!availableAt) {
    // Старый ответ без момента: показать час можно, обещать день — нет.
    return availableFrom ? { kind: 'unknown', time: availableFrom } : null;
  }

  const at = new Date(availableAt);
  if (Number.isNaN(at.getTime())) {
    return availableFrom ? { kind: 'unknown', time: availableFrom } : null;
  }

  const time =
    availableFrom ??
    `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

  // Сравниваем КАЛЕНДАРНЫЕ дни, а не «меньше 24 часов»: открытие в 07:00
  // завтрашнего дня наступает через 19 часов, но это всё равно завтра.
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );

  if (days <= 0) return { kind: 'today', time };
  if (days === 1) return { kind: 'tomorrow', time };
  return { kind: 'later', time, at };
}

/**
 * ОДНА ФОРМУЛИРОВКА «КОГДА ОТКРОЕТСЯ» НА ВСЕ МЕСТА ВИТРИНЫ.
 *
 * ПОЧЕМУ ФУНКЦИЯ, А НЕ ПЯТЬ ВЫЗОВОВ `t` ПО МЕСТАМ. Их и было пять: плитка на
 * главной, шапка заведения, строка в меню, заголовок закрытого заведения и
 * карточка позиции. Четыре говорили коротко — «Откроется в 07:00», — и только
 * карточка называла день. В восемь вечера короткая фраза читается как «сегодня
 * утром»: гость ждёт того, чего сегодня уже не будет. Разъехались они не по
 * недосмотру, а потому что каждое место само выбирало ключ; пока выбор делается
 * на месте, он разъедется снова.
 *
 * ДЕНЬ НАЗЫВАЕТСЯ ВСЕГДА, даже когда он сегодняшний: «Откроется сегодня в 07:00»
 * длиннее, чем «Откроется в 07:00», ровно на то слово, из-за которого фраза
 * перестаёт быть двусмысленной. Исключение одно — когда дня мы не знаем
 * (старый ответ сервера без момента): тогда говорим только час, потому что
 * назвать день было бы враньём.
 */
export function openingLabel(
  source: {
    available_from?: string | null;
    /** Тот же час под другим именем: так его зовёт статус заведения. */
    opens_at?: string | null;
    available_at?: string | null;
  },
  t: (key: string, options?: Record<string, unknown>) => string,
  now: Date = new Date(),
): string | null {
  const next = nextOpening(source.available_from ?? source.opens_at, source.available_at, now);
  if (!next) return null;

  switch (next.kind) {
    case 'today':
      return t('guest.opening.today', { time: next.time });
    case 'tomorrow':
      return t('guest.opening.tomorrow', { time: next.time });
    case 'later':
      return t('guest.opening.later', {
        time: next.time,
        day: next.at.toLocaleDateString(undefined, { weekday: 'long' }),
      });
    case 'unknown':
      return t('guest.opening.unknown', { time: next.time });
    default:
      // Ближайшего открытия нет вовсе — сказать «когда» нечего, и выдумывать
      // это «когда» нельзя. Место само решит, что показать вместо.
      return null;
  }
}
