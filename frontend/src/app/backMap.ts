import type { TFunction } from 'i18next';

import { cmsPath } from '@/app/hostRole';
import { pickTranslated } from '@/utils/translated';

/**
 * КАРТА МАРШРУТОВ «← НАЗАД» (партия 56).
 *
 * Внутренний экран знает своего родителя не по истории браузера, а по смыслу:
 * блюдо и раздел меню — в меню своего заведения, заведение — в списке
 * сервисов, карточка отеля — в списке отелей, заказ и «Мои точки» — на доске.
 * Карта — одна, чистая функция: адрес и данные экрана на входе, адрес
 * родителя и подпись на выходе.
 *
 * Экраны, чьё место живёт в запросе (`?section=fleet&hotel=…` консоли,
 * `?t=…` ресепшена), отдают запрос в `ctx.search`: по одному пути там не
 * различить список и карточку.
 */
export interface BackTarget {
  to: string;
  label: string;
}

export interface BackContext {
  /** Заведение, в чьём меню лежит раздел/позиция. */
  service?: { id: string; name?: Record<string, string> } | null;
  language?: string;
  fallbackLanguage?: string;
  /** Текущий запрос адреса (`?…`) — для экранов, у которых место в запросе. */
  search?: string;
  /** Запрос доски трекера (`?mine=1…`), с которым на неё вернуться. */
  boardSearch?: string;
  /** Домашний экран человека — `homePathFor(user)`. */
  home?: string;
}

type Resolver = (match: RegExpMatchArray, ctx: BackContext, t: TFunction) => BackTarget | null;

/** Меню заведения, а без заведения — список сервисов. */
const toServiceMenu: Resolver = (_m, ctx, t) => {
  if (!ctx.service?.id) return { to: cmsPath('/services'), label: t('nav.services') };
  const name = pickTranslated(ctx.service.name ?? {}, ctx.language ?? 'ru', ctx.fallbackLanguage ?? 'ru');
  return {
    to: cmsPath(`/services/${ctx.service.id}`),
    label: name ? t('back.serviceMenu', { name }) : t('back.menu'),
  };
};

/** Доска — с теми фильтрами, с которыми с неё ушли. */
const toBoard: Resolver = (_m, ctx, t) => ({
  to: `/tracker${ctx.boardSearch ?? ''}`,
  label: t('back.board'),
});

/** Домашний экран: дашборд, «Мои точки» или доска — по правам человека. */
const toHome: Resolver = (_m, ctx, t) => {
  const home = ctx.home ?? cmsPath('/dashboard');
  if (home.startsWith('/tracker/my-points')) return { to: home, label: t('tracker.myPoints.title') };
  if (home.startsWith('/tracker')) return { to: home, label: t('back.board') };
  return { to: home, label: t('nav.dashboard') };
};

/** Ресепшен: из открытого диалога — к списку диалогов, из списка — на доску. */
const fromDesk: Resolver = (m, ctx, t) => {
  const params = new URLSearchParams(ctx.search ?? '');
  if (!params.get('t')) return toBoard(m, ctx, t);
  params.delete('t');
  const rest = params.toString();
  return { to: `/tracker/desk${rest ? `?${rest}` : ''}`, label: t('back.dialogs') };
};

/**
 * NaviRoom Control: из карточки отеля — в список отелей С ЕГО ФИЛЬТРАМИ.
 *
 * Фильтры флота лежат в том же адресе (`openHotel` их не трогает), поэтому
 * достаточно снять сам отель и вкладку карточки. Ссылка — запросом (`?…`):
 * путь консоли остаётся прежним, меняется только место в нём.
 */
const fromConsole: Resolver = (_m, ctx, t) => {
  const params = new URLSearchParams(ctx.search ?? '');
  if (params.get('section') !== 'fleet' || !params.get('hotel')) return null;
  params.delete('hotel');
  params.delete('tab');
  return { to: `?${params.toString()}`, label: t('admin.nav.fleet') };
};

const MAP: Array<[RegExp, Resolver]> = [
  [/\/menu\/items\/[^/]+$/, toServiceMenu],
  [/\/menu\/categories\/[^/]+$/, toServiceMenu],
  [/\/services\/[^/]+$/, (_m, _c, t) => ({ to: cmsPath('/services'), label: t('nav.services') })],
  [/^\/tracker\/order\/[^/]+$/, toBoard],
  [/^\/tracker\/my-points$/, toBoard],
  [/^\/tracker\/desk$/, fromDesk],
  [/\/(profile|styleguide)$/, toHome],
  [/^\/admin$/, fromConsole],
];

export function parentOf(pathname: string, ctx: BackContext, t: TFunction): BackTarget | null {
  for (const [pattern, resolve] of MAP) {
    const match = pathname.match(pattern);
    if (match) return resolve(match, ctx, t);
  }
  return null;
}

/*
  ЗАПРОС ДОСКИ ПОМНИТСЯ НА ВКЛАДКУ (партия 56).

  Карточка заказа несёт запрос доски в своём адресе, но заказ открывают и
  по прямой ссылке — из истории, уведомления, сообщения коллеги, — а
  «Мои точки» и ресепшен вовсе живут на своих адресах. Возврат «← Доска»
  обязан вернуть ту выборку, с которой человек ушёл, а не голую доску:
  вкладка помнит последний запрос доски. `sessionStorage`, а не
  `localStorage`: фильтр — часть текущей работы, а не настройка устройства.
*/
const BOARD_SEARCH_KEY = 'itv.tracker.boardSearch';

export function rememberBoardSearch(search: string): void {
  try {
    window.sessionStorage.setItem(BOARD_SEARCH_KEY, search);
  } catch {
    /* хранилище недоступно — вернёмся на голую доску */
  }
}

export function recallBoardSearch(): string {
  try {
    const value = window.sessionStorage.getItem(BOARD_SEARCH_KEY) ?? '';
    return value.startsWith('?') ? value : '';
  } catch {
    return '';
  }
}
