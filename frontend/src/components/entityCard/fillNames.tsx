import { Fragment, type ReactNode } from 'react';

/**
 * ИМЕНА ВНУТРИ ПЕРЕВЕДЁННОЙ СТРОКИ (партия 59а).
 *
 * «Комната {{room}} · Бассейн» — строка из словаря, и порядок слов в ней у
 * каждого языка свой. Имя с карточкой нельзя склеить конкатенацией: в арабском
 * номер стоит не там, где в русском. Поэтому в перевод подставляется МЕТКА,
 * строка режется по меткам, и на их место встают узлы. Текст на экране
 * остаётся буква в букву прежним — проверки по тексту не ломаются.
 *
 *     fillNames(t('tracker.card.room', { room: mark('room') }), { room: <EntityName …>305</EntityName> })
 */

const OPEN = '⁣⟦';
const CLOSE = '⟧⁣';

export function mark(name: string): string {
  return `${OPEN}${name}${CLOSE}`;
}

export function fillNames(text: string, names: Record<string, ReactNode>): ReactNode {
  const pattern = /⁣⟦(\w+)⟧⁣/g;
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<Fragment key={`${match[1]}-${at}`}>{names[match[1]] ?? match[1]}</Fragment>);
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
