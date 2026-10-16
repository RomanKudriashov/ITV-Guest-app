import type { TFunction } from 'i18next';

import { cmsPath } from '@/app/hostRole';
import { pickTranslated } from '@/utils/translated';

/**
 * КАРТА МАРШРУТОВ «← НАЗАД» (партия 56).
 *
 * Внутренний экран знает своего родителя не по истории браузера, а по смыслу:
 * блюдо и раздел меню — в меню своего заведения, заведение — в списке
 * сервисов, карточка отеля — в списке отелей. Карта — одна, чистая функция:
 * адрес и данные экрана на входе, адрес родителя и подпись на выходе.
 *
 * Шаг 1 (образцы) заполняет её для редакторов меню; остальные внутренние
 * экраны (карточка отеля, заказ трекера, «Мои точки», ресепшен) добавляются
 * при раскатке — список в отчёте партии 56.
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
}

type Resolver = (match: RegExpMatchArray, ctx: BackContext, t: TFunction) => BackTarget;

/** Меню заведения, а без заведения — список сервисов. */
const toServiceMenu: Resolver = (_m, ctx, t) => {
  if (!ctx.service?.id) return { to: cmsPath('/services'), label: t('nav.services') };
  const name = pickTranslated(ctx.service.name ?? {}, ctx.language ?? 'ru', ctx.fallbackLanguage ?? 'ru');
  return {
    to: cmsPath(`/services/${ctx.service.id}`),
    label: name ? t('back.serviceMenu', { name }) : t('back.menu'),
  };
};

const MAP: Array<[RegExp, Resolver]> = [
  [/\/menu\/items\/[^/]+$/, toServiceMenu],
  [/\/menu\/categories\/[^/]+$/, toServiceMenu],
  [/\/services\/[^/]+$/, (_m, _c, t) => ({ to: cmsPath('/services'), label: t('nav.services') })],
];

export function parentOf(pathname: string, ctx: BackContext, t: TFunction): BackTarget | null {
  for (const [pattern, resolve] of MAP) {
    const match = pathname.match(pattern);
    if (match) return resolve(match, ctx, t);
  }
  return null;
}
