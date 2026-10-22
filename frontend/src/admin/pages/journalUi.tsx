import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { useTranslation } from 'react-i18next';

import { formatDate, formatDateTime } from '@/utils/dates';
import { accent, ink, surface, typo } from '../adminTokens';
import type { JournalActor, JournalChange, JournalEntry } from '../adminClient';
import { Pill, type Tone } from './hotels/hotelsUi';

/**
 * СТРОКА ЖУРНАЛА (партия 62-D) — одна на «Историю» отеля и «Журнал
 * действий»: когда, кто (имя и роль), что, над чем, «было → стало» и
 * подробности. Код действия — для инженера, на экране его нет: подсказкой
 * при наведении на запись, на телефоне — по долгому нажатию (партия 62-E2).
 */

const ROLE_TONE: Record<string, Tone> = { owner: 'gold', support: 'info', read_only: 'muted', system: 'muted', hotel: 'muted' };

export const PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;

export function ActorLabel({ actor }: { actor: JournalActor }) {
  const { t } = useTranslation();
  const role = actor.role || 'system';
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
      <Box component="span" sx={{ color: accent.soft, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {actor.name || t('admin.journal.system')}
      </Box>
      <Pill tone={ROLE_TONE[role] ?? 'muted'}>{t(`admin.journal.role.${role}`, { defaultValue: role })}</Pill>
    </Box>
  );
}

export function useJournalWords() {
  const { t } = useTranslation();
  const field = (name: string) =>
    name.startsWith('module:')
      ? t(`admin.module.${name.slice(7)}`, { defaultValue: name.slice(7) })
      : t(`admin.profile.field.${name}`, { defaultValue: t(`admin.journal.field.${name}`, { defaultValue: name }) });
  const value = (change: JournalChange, side: unknown): string => {
    if (side === null || side === undefined || side === '') return '—';
    if (typeof side === 'boolean') {
      return change.field.startsWith('module:') ? t(side ? 'admin.journal.on' : 'admin.journal.off') : t(side ? 'admin.journal.yes' : 'admin.journal.no');
    }
    if (Array.isArray(side)) return side.length ? side.join(', ') : '—';
    if (typeof side === 'object') {
      const pairs = Object.entries(side as Record<string, unknown>).filter(([, text]) => text);
      return pairs.length ? pairs.map(([lang, text]) => `${lang.toUpperCase()}: ${String(text)}`).join(' · ') : '—';
    }
    return String(side);
  };
  const object = (entry: JournalEntry): string => {
    const o = entry.object;
    if (!o) return '';
    if (o.kind === 'module') return t(`admin.module.${o.code}`, { defaultValue: o.code ?? '' });
    if (o.kind === 'node') return t('admin.journal.object.node', { name: o.name });
    if (o.kind === 'variant') return o.version ? t('admin.journal.object.variantVersion', { code: o.code, version: o.version }) : t('admin.journal.object.variant', { code: o.code });
    return '';
  };
  const details = (entry: JournalEntry): string[] => {
    const d = entry.details ?? {};
    const lines: string[] = [];
    // `in_development` — причина системной записи миграции 0049 (партия 62-E1):
    // код на экран не выводится, у него своя фраза.
    if (d.reason === 'in_development') lines.push(t('admin.journal.detail.inDevelopment'));
    else if (typeof d.reason === 'string') lines.push(t('admin.card.activation.reason', { reason: d.reason }));
    if (typeof d.enable_on === 'string') lines.push(t('admin.card.activation.enableOn', { date: formatDate(d.enable_on) }));
    if (d.auto === true) lines.push(t('admin.card.activation.auto'));
    if (typeof d.ttl_minutes === 'number') lines.push(t('admin.journal.detail.ttl', { count: d.ttl_minutes }));
    if (typeof d.group === 'string' && d.group) lines.push(t('admin.journal.detail.group', { group: d.group }));
    if (d.bulk === true) lines.push(t('admin.journal.detail.bulk'));
    if (typeof d.to_version === 'number') lines.push(t('admin.journal.detail.toVersion', { version: d.to_version }));
    // Запись модулей до партии 62-D: только число, без «было → стало».
    if (typeof d.count === 'number' && !entry.changes.length) lines.push(t('admin.journal.detail.legacyCount', { count: d.count }));
    return lines;
  };
  return { field, value, object, details };
}

export function JournalRow({ entry, testId, aside }: { entry: JournalEntry; testId: string; aside?: ReactNode }) {
  const { t } = useTranslation();
  const words = useJournalWords();
  const objectText = words.object(entry);
  const lines = words.details(entry);
  return (
    <Tooltip
      title={entry.action}
      placement="top-start"
      enterDelay={500}
      enterNextDelay={500}
      // Долгое нажатие на телефоне: короткое касание — это прокрутка списка.
      enterTouchDelay={600}
      leaveTouchDelay={4000}
      slotProps={{ tooltip: { 'data-testid': 'admin-journal-code' } as Record<string, string> }}
    >
    <Box
      data-testid={testId}
      data-action={entry.action}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '170px minmax(0, 1fr) auto' },
        columnGap: 1.5,
        rowGap: 0.5,
        py: 1.25,
        borderBottom: `1px solid ${surface.hair}`,
        ...typo.caption,
      }}
    >
      <Box sx={{ color: ink.low }}>{formatDateTime(entry.at)}</Box>
      <Box sx={{ minWidth: 0, display: 'grid', gap: 0.4 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <ActorLabel actor={entry.actor} />
          {entry.via_support ? <Pill tone="warn">{t('admin.hotel.viaSupport')}</Pill> : null}
        </Box>
        <Box sx={{ color: ink.hi, fontWeight: 600 }}>
          {t(`admin.action.${entry.action}`, { defaultValue: entry.action })}
          {objectText ? <Box component="span" sx={{ color: ink.mid, fontWeight: 400 }}> · {objectText}</Box> : null}
        </Box>
        {entry.changes.map((change) => (
          <Box key={change.field} data-testid={`admin-journal-change-${change.field}`} sx={{ color: ink.mid, overflowWrap: 'anywhere' }}>
            <b>{words.field(change.field)}:</b> {words.value(change, change.from)} → {words.value(change, change.to)}
          </Box>
        ))}
        {lines.map((line) => (
          <Box key={line} sx={{ color: ink.mid, overflowWrap: 'anywhere' }}>{line}</Box>
        ))}
      </Box>
      {aside ? <Box sx={{ justifySelf: { md: 'end' } }}>{aside}</Box> : <Box />}
    </Box>
    </Tooltip>
  );
}
