import type { TFunction } from 'i18next';

import type { DashboardAttention } from './types';

/**
 * Слова для карточки «требует внимания».
 *
 * Отдельным файлом, потому что здесь ЖИВЁТ ГЛАВНОЕ: у каждой карточки не
 * только заголовок с числом, но и вторая строка — чем это грозит. Метка
 * «Нет эскалации» годами висела в списке сервисов без объяснения, и никто не
 * знал, что она значит и что с ней делать. Число само по себе не сообщение.
 */
export function attentionText(
  card: DashboardAttention,
  t: TFunction,
): { title: string; hint: string } {
  switch (card.code) {
    case 'node_offline':
      return {
        title: t('dashboard.card.node_offline', { minutes: card.minutes ?? 0 }),
        hint: t('dashboard.card.nodeOfflineHint'),
      };
    case 'tariff_over':
      return {
        title: t('dashboard.card.tariff_over', {
          // Ресурс называем словом: «services 2 / 1» — это строка из кода,
          // а не сообщение человеку.
          resource: t(`dashboard.card.resource.${card.resource}`, card.resource ?? ''),
          used: card.used ?? 0,
          limit: card.limit ?? 0,
        }),
        hint: t('dashboard.card.tariffOverHint'),
      };
    case 'no_escalation':
      return {
        title: t('dashboard.card.no_escalation', { count: card.count ?? 0 }),
        // Названия заведений прямо в подсказке: без них администратор идёт
        // сверять список руками.
        hint: card.names?.length
          ? `${t('dashboard.card.noEscalationHint')} · ${card.names.join(', ')}`
          : t('dashboard.card.noEscalationHint'),
      };
    case 'delivery_failed':
      return {
        title: t('dashboard.card.delivery_failed', { count: card.count ?? 0 }),
        hint: t('dashboard.card.deliveryFailedHint'),
      };
    case 'escalated':
      return {
        title: t('dashboard.card.escalated', { count: card.count ?? 0 }),
        hint: t('dashboard.card.escalatedHint'),
      };
    case 'stop_list':
      return {
        title: t('dashboard.card.stop_list', { count: card.count ?? 0 }),
        hint: t('dashboard.card.stopListHint'),
      };
    case 'overdue':
    default:
      return {
        title: t('dashboard.card.overdue', { count: card.count ?? 0 }),
        hint: t('dashboard.card.overdueHint'),
      };
  }
}
