import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { useTranslation } from 'react-i18next';

import { languageName, timezoneName } from '@/components/hotelFieldOptions';
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

// Значения, что ввёл человек (адрес и логин сервера управления, 63-3), — данные, не слова экрана.
const DATA_FIELDS = new Set(['control_host', 'control_login']);

export function ActorLabel({ actor }: { actor: JournalActor }) {
  const { t } = useTranslation();
  const role = actor.role || 'system';
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
      <Box component="span" sx={{ color: accent.soft, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {actor.name || t('admin.journal.system')}
      </Box>
      <Pill tone={ROLE_TONE[role] ?? 'muted'}>{t(`admin.journal.role.${role}`, { defaultValue: t('admin.hotels.filter.unknownValue') })}</Pill>
    </Box>
  );
}

export function useJournalWords() {
  const { t, i18n } = useTranslation();
  const unknown = t('admin.hotels.filter.unknownValue');
  const field = (name: string) =>
    // Строка действия пачкой (63-2): «было → стало» по номеру.
    name.startsWith('room:')
      ? t('admin.journal.object.room', { number: name.slice(5) })
      : name.startsWith('module:')
      ? t(`admin.module.${name.slice(7)}`, { defaultValue: unknown })
      : t(`admin.profile.field.${name}`, { defaultValue: t(`admin.journal.field.${name}`, { defaultValue: unknown }) });
  /*
    ЗНАЧЕНИЕ СЛОВОМ, А НЕ КОДОМ (партия 62-F): валюта — «евро», язык —
    «английский», модуль — его название. Код из базы на экран не выводится.
  */
  const word = (name: string, item: string): string => {
    const key = name.replace(/^.*\./, '');
    if (key === 'currency') {
      try {
        return new Intl.DisplayNames([i18n.language], { type: 'currency' }).of(item) ?? item;
      } catch {
        return item;
      }
    }
    if (key === 'default_language' || key === 'languages' || key === 'language') return languageName(item, i18n.language);
    if (key === 'timezone') return timezoneName(item, i18n.language);
    if (key === 'modules' || key === 'auto_modules' || key === 'module') return t(`admin.module.${item}`, { defaultValue: unknown });
    // Правило номеров (партия 63-1): «0» у этажа — «всё перед позицией», не число.
    if (key === 'room_floor_digits') return item === '0' ? t('admin.card.rooms.rule.floorAll') : t('admin.card.rooms.rule.floorFirst', { n: item });
    if (key === 'room_position_digits') return t('admin.card.rooms.rule.lastDigits', { n: item });
    // Сервер управления (63-3): тип, протокол, вход — словами; секрет — только «изменён».
    if (key === 'control_kind') return t(`admin.card.conn.form.kinds.${item}`, { defaultValue: unknown });
    if (key === 'control_protocol') return t(`admin.card.conn.form.protocols.${item}`, { defaultValue: unknown });
    if (key === 'control_auth') return t(`admin.card.conn.form.auths.${item}`, { defaultValue: unknown });
    if (key === 'control_secret') return t('admin.journal.detail.secretChanged');
    // Уборка — словом панели отеля, а не кодом из базы (63-1).
    if (key === 'room_housekeeping') return t(`entityCard.room.housekeeping.${item}`, { defaultValue: unknown });
    return item;
  };
  const value = (change: JournalChange, side: unknown): string => {
    if (side === null || side === undefined || side === '') return '—';
    if (typeof side === 'boolean') {
      return change.field.startsWith('module:') ? t(side ? 'admin.journal.on' : 'admin.journal.off') : t(side ? 'admin.journal.yes' : 'admin.journal.no');
    }
    if (Array.isArray(side)) return side.length ? side.map((item) => word(change.field, String(item))).join(', ') : '—';
    if (typeof side === 'object') {
      const pairs = Object.entries(side as Record<string, unknown>).filter(([, text]) => text);
      return pairs.length ? pairs.map(([lang, text]) => `${languageName(lang, i18n.language)}: ${String(text)}`).join(' · ') : '—';
    }
    return word(change.field, String(side));
  };
  const object = (entry: JournalEntry): ReactNode => {
    const o = entry.object;
    if (!o) return '';
    if (o.kind === 'module') return t(`admin.module.${o.code}`, { defaultValue: t('admin.hotels.filter.unknownValue') });
    if (o.kind === 'node') return withData('admin.journal.object.node', 'name', String(o.name ?? ''));
    if (o.kind === 'room') return withData('admin.journal.object.room', 'number', String(o.number ?? ''));
    if (o.kind === 'building') return withData('admin.journal.object.building', 'name', String(o.name ?? ''));
    if (o.kind === 'category') return withData('admin.journal.object.category', 'name', String(o.name ?? ''));
    if (o.kind === 'variant') return o.version ? t('admin.journal.object.variantVersion', { code: o.code, version: o.version }) : t('admin.journal.object.variant', { code: o.code });
    return '';
  };
  /*
    То, что ввёл человек (причина, название группы, имя коннектора), — данные,
    а не слова экрана: оборачиваются `data-words="data"` для сторожа слов
    Control (партия 62-F). Перевод строки сохраняется целиком: на месте
    значения — метка, по ней строка режется.
  */
  const withData = (key: string, name: string, data: string): ReactNode => {
    const [before, after = ''] = t(key, { [name]: MARK }).split(MARK);
    return (
      <>
        {before}
        <Box component="span" data-words="data">{data}</Box>
        {after}
      </>
    );
  };
  const details = (entry: JournalEntry): ReactNode[] => {
    const d = entry.details ?? {};
    const lines: ReactNode[] = [];
    // `in_development` — причина системной записи миграции 0049 (партия 62-E1):
    // код на экран не выводится, у него своя фраза.
    if (d.reason === 'in_development') lines.push(t('admin.journal.detail.inDevelopment'));
    else if (typeof d.reason === 'string') lines.push(withData('admin.card.activation.reason', 'reason', d.reason));
    if (typeof d.enable_on === 'string') lines.push(t('admin.card.activation.enableOn', { date: formatDate(d.enable_on) }));
    if (d.auto === true) lines.push(t('admin.card.activation.auto'));
    if (typeof d.ttl_minutes === 'number') lines.push(t('admin.journal.detail.ttl', { count: d.ttl_minutes }));
    if (typeof d.group === 'string' && d.group) lines.push(withData('admin.journal.detail.group', 'group', d.group));
    if (d.bulk === true) lines.push(t('admin.journal.detail.bulk'));
    if (typeof d.to_version === 'number') lines.push(t('admin.journal.detail.toVersion', { version: d.to_version }));
    // Номерной фонд (63-1): сколько добавлено, перенесено, закрыто сессий.
    if (typeof d.created === 'number' && d.created) lines.push(t('admin.journal.detail.created', { count: d.created }));
    if (typeof d.moved === 'number' && d.moved) lines.push(t('admin.journal.detail.moved', { count: d.moved }));
    if (typeof d.revoked === 'number' && d.revoked) lines.push(t('admin.journal.detail.revoked', { count: d.revoked }));
    // Действие над многими номерами (63-2): какое и с каким значением.
    if (typeof d.batch === 'string') {
      const kind = t(`admin.card.rooms.batch.kind.${d.batch}`, { defaultValue: unknown });
      lines.push(typeof d.value === 'string' && d.value ? t('admin.journal.detail.batchValue', { kind, value: d.value }) : t('admin.journal.detail.batch', { kind }));
    }
    // Запись модулей до партии 62-D: только число, без «было → стало».
    if (typeof d.count === 'number' && !entry.changes.length) lines.push(t('admin.journal.detail.legacyCount', { count: d.count }));
    return lines;
  };
  return { field, value, object, details };
}

/** Метка места значения в переведённой строке: в тексте её не бывает. */
const MARK = '\u0001';

export function JournalRow({ entry, testId, aside }: { entry: JournalEntry; testId: string; aside?: ReactNode }) {
  const { t } = useTranslation();
  const words = useJournalWords();
  const objectText = words.object(entry);
  const lines = words.details(entry);
  return (
    <Tooltip
      title={entry.action}
      // Под курсором и вниз от него (партия 62-F): над записью подсказка
      // закрывала счётчик «Показано N из M» и строку выше.
      followCursor
      placement="bottom-start"
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
          {t(`admin.action.${entry.action}`, { defaultValue: t('admin.journal.otherAction') })}
          {objectText ? <Box component="span" sx={{ color: ink.mid, fontWeight: 400 }}> · {objectText}</Box> : null}
        </Box>
        {entry.changes.map((change) => (
          <Box key={change.field} data-testid={`admin-journal-change-${change.field}`} sx={{ color: ink.mid, overflowWrap: 'anywhere' }}>
            <b>{words.field(change.field)}:</b>{' '}
            {DATA_FIELDS.has(change.field) ? (
              <>
                <span data-words="data">{words.value(change, change.from)}</span> → <span data-words="data">{words.value(change, change.to)}</span>
              </>
            ) : (
              <>
                {words.value(change, change.from)} → {words.value(change, change.to)}
              </>
            )}
          </Box>
        ))}
        {lines.map((line, index) => (
          <Box key={index} sx={{ color: ink.mid, overflowWrap: 'anywhere' }}>{line}</Box>
        ))}
      </Box>
      {aside ? <Box sx={{ justifySelf: { md: 'end' } }}>{aside}</Box> : <Box />}
    </Box>
    </Tooltip>
  );
}
