import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { accent, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { AdminDialog } from '../form';
import type { Layer, MockRoom } from './roomsData';

/**
 * ОБЩИЕ ЧАСТИ ПЕСОЧНИЦЫ 63-М: переключатель вариантов, «образец», слои цвета,
 * карточка номера при наведении, окно-заглушка действия. Всё — на словаре
 * Control (adminTokens), без своих цветов.
 */

export type Go = (next: Record<string, string | null>, replace?: boolean) => void;

export function useGo(): [URLSearchParams, Go] {
  const [params, setParams] = useSearchParams();
  const go: Go = (next, replace = true) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === '') out.delete(key);
      else out.set(key, value);
    }
    setParams(out, { replace });
  };
  return [params, go];
}

/** Плашка «образец» — у всего, чего нет в данных. */
export function Sample({ children = 'образец' }: { children?: ReactNode }) {
  return (
    <Box
      component="span"
      data-testid="sandbox-sample"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.75,
        py: 0.1,
        borderRadius: `${shape.pill}px`,
        border: `1px dashed ${state.gold}`,
        color: state.gold,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

export interface VariantInfo {
  key: string;
  title: string;
  idea: string;
}

/** «Вариант А · Б · В» с идеей одной строкой — сверху каждого экрана. */
export function VariantBar({ variants, value, onChange }: { variants: VariantInfo[]; value: string; onChange: (key: string) => void }) {
  const current = variants.find((v) => v.key === value) ?? variants[0];
  return (
    <Box sx={{ ...panelSx, p: 1.25, mb: 2, display: 'grid', gap: 1 }} data-testid="sandbox-variants">
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {variants.map((v) => (
          <ButtonBase
            key={v.key}
            onClick={() => onChange(v.key)}
            data-testid={`sandbox-variant-${v.key}`}
            aria-pressed={v.key === current.key}
            sx={{
              px: 1.5,
              py: 0.75,
              borderRadius: `${shape.radiusSmall}px`,
              ...typo.caption,
              fontWeight: 700,
              color: v.key === current.key ? accent.onAccent : ink.mid,
              bgcolor: v.key === current.key ? accent.main : surface.s2,
              border: `1px solid ${v.key === current.key ? accent.main : surface.line}`,
            }}
          >
            {v.title}
          </ButtonBase>
        ))}
      </Box>
      <Typography sx={{ ...typo.caption, color: ink.mid }}>
        <b>Идея:</b> {current.idea}
      </Typography>
    </Box>
  );
}

export function PageHead({ title, subtitle, aside }: { title: string; subtitle?: ReactNode; aside?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap', mb: 2 }}>
      <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
        <Typography component="h1" sx={{ ...typo.pageTitle, color: ink.hi }}>{title}</Typography>
        {subtitle ? <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5, maxWidth: 820 }}>{subtitle}</Typography> : null}
      </Box>
      {aside}
    </Box>
  );
}

/* ── Слои цвета ─────────────────────────────────────────────────────────── */

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'gold' | 'muted';

export const LAYERS: Array<{ key: Layer; label: string; sample?: boolean; help: string }> = [
  { key: 'control', label: 'Готовность управления', help: 'Привязан ли номер к варианту, есть ли PIN и отвечает ли оборудование — всё, что нужно, чтобы гость управлял номером.' },
  { key: 'variant', label: 'Вариант номера', help: 'Какая настроенная схема управления у номера. Одинаковые номера получают один вариант.' },
  { key: 'pin', label: 'PIN', help: 'Есть ли у номера действующий PIN для входа гостя в управление номером.' },
  { key: 'problems', label: 'Проблемы', help: 'Что мешает номеру работать: нет варианта, нет PIN, оборудование не отвечает.' },
  { key: 'occupancy', label: 'Занятость', sample: true, help: 'Занят, свободен, на уборке, не продаётся. Сейчас данных о занятости нет — показан образец.' },
];

/**
 * Оттенки вариантов — из словаря, смешением (`color-mix`): своих цветов у
 * песочницы нет (сторож `check-colors`). Красного и жёлтого «проблем» здесь
 * нет — вариант не должен выглядеть бедой.
 */
const mix = (a: string, b: string, pa: number) => `color-mix(in srgb, ${a} ${pa}%, ${b})`;
const VARIANT_HUES = [
  accent.main,
  state.info,
  state.gold,
  state.ok,
  accent.light,
  mix(state.info, state.ok, 50),
  mix(state.gold, accent.main, 50),
  mix(state.ok, state.gold, 50),
  accent.deep,
  mix(state.info, accent.deep, 50),
  mix(state.ok, accent.deep, 50),
  mix(state.gold, state.info, 50),
];

export interface Paint {
  /** Цвет заливки: переменная словаря или конкретный оттенок варианта. */
  fill: string;
  /** Подпись значения для легенды и карточки. */
  label: string;
  /** Ключ значения — для счётчиков легенды. */
  value: string;
}

export function paint(room: MockRoom, layer: Layer, variants: string[]): Paint {
  const tone = (t: Tone) => (t === 'muted' ? 'var(--adm-state-muted-wash)' : state[t]);
  if (!room.active) return { fill: 'var(--adm-state-muted-wash)', label: 'не используется', value: 'inactive' };
  switch (layer) {
    case 'variant': {
      if (!room.variant) return { fill: 'var(--adm-state-muted-wash)', label: 'без варианта', value: '' };
      const i = variants.indexOf(room.variant);
      return { fill: VARIANT_HUES[i % VARIANT_HUES.length], label: room.variant, value: room.variant };
    }
    case 'pin':
      return room.pin ? { fill: tone('ok'), label: 'PIN есть', value: 'yes' } : { fill: tone('warn'), label: 'PIN нет', value: 'no' };
    case 'problems':
      if (room.problems.includes('silent')) return { fill: tone('bad'), label: 'оборудование не отвечает', value: 'silent' };
      if (room.problems.includes('noVariant')) return { fill: tone('warn'), label: 'нет варианта', value: 'noVariant' };
      if (room.problems.includes('noPin')) return { fill: tone('info'), label: 'нет PIN', value: 'noPin' };
      return { fill: tone('ok'), label: 'без проблем', value: 'ok' };
    case 'occupancy':
      return {
        occupied: { fill: tone('info'), label: 'занят', value: 'occupied' },
        free: { fill: tone('ok'), label: 'свободен', value: 'free' },
        cleaning: { fill: tone('gold'), label: 'уборка', value: 'cleaning' },
        out: { fill: tone('muted'), label: 'не продаётся', value: 'out' },
      }[room.occupancy];
    default: {
      if (room.problems.includes('silent')) return { fill: tone('bad'), label: 'мешает гостю', value: 'bad' };
      if (room.problems.length) return { fill: tone('warn'), label: 'требует внимания', value: 'warn' };
      return { fill: tone('ok'), label: 'готов', value: 'ok' };
    }
  }
}

/** Легенда слоя со счётчиками. */
export function Legend({ rooms, layer, variants }: { rooms: MockRoom[]; layer: Layer; variants: string[] }) {
  const counts = new Map<string, { paint: Paint; n: number }>();
  for (const room of rooms) {
    const p = paint(room, layer, variants);
    const entry = counts.get(p.value) ?? { paint: p, n: 0 };
    entry.n += 1;
    counts.set(p.value, entry);
  }
  return (
    <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }} data-testid="sandbox-legend">
      {[...counts.values()]
        .sort((a, b) => b.n - a.n)
        .map(({ paint: p, n }) => (
          <Box key={p.value || 'none'} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, ...typo.caption, color: ink.mid }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: p.fill, border: `1px solid ${surface.line}` }} />
            {p.label} <b style={{ color: 'inherit' }}>{n}</b>
          </Box>
        ))}
    </Box>
  );
}

/** Карточка номера при наведении — как карточка сущности в панели. */
export function RoomTip({ room, children }: { room: MockRoom; children: ReactNode }) {
  const row = (label: string, value: ReactNode) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      <b>{value}</b>
    </Box>
  );
  return (
    <Tooltip
      enterDelay={250}
      enterTouchDelay={500}
      title={
        <Box sx={{ ...typo.caption, display: 'grid', gap: 0.4, minWidth: 220, p: 0.5 }} data-testid={`sandbox-room-tip-${room.number}`}>
          <Box sx={{ fontWeight: 800, fontSize: 14 }}>Номер {room.number}</Box>
          {row('Корпус', room.building || '—')}
          {row('Этаж', <>{room.floor || '—'}{room.derived ? ' · из номера' : ''}</>)}
          {row('Категория', room.category || '—')}
          {row('Вариант', room.variant ?? 'не назначен')}
          {row('PIN', room.pin ? 'есть' : 'нет')}
          {row('Связь', room.control === 'ok' ? 'на связи' : room.control === 'silent' ? 'не отвечает' : 'управления нет')}
          {row('Занятость (образец)', { occupied: 'занят', free: 'свободен', cleaning: 'уборка', out: 'не продаётся' }[room.occupancy])}
        </Box>
      }
    >
      <Box component="span" sx={{ display: 'contents' }}>{children}</Box>
    </Tooltip>
  );
}

/** Окно действия: показывает, что произойдёт, но ничего не отправляет. */
export function MockAction({ title, children, onClose, confirm = 'Применить' }: { title: string; children: ReactNode; onClose: () => void; confirm?: string }) {
  return (
    <AdminDialog
      title={title}
      onClose={onClose}
      testId="sandbox-action"
      actions={
        <>
          <Button sx={secondaryButtonSx} onClick={onClose}>Отмена</Button>
          <Button sx={primaryButtonSx} onClick={onClose}>{confirm}</Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 1.25, ...typo.body, color: ink.hi }}>
        {children}
        <Box sx={{ ...typo.caption, color: ink.low }}>Песочница: окно показывает, что произойдёт, и ничего не сохраняет.</Box>
      </Box>
    </AdminDialog>
  );
}

/** Ряд-плашка под выбором: сколько выбрано и что с ними сделать. */
export function SelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <Box
      data-testid="sandbox-selection"
      sx={{
        position: 'sticky',
        bottom: 12,
        zIndex: 5,
        mt: 1.5,
        ...panelSx,
        p: 1,
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        flexWrap: 'wrap',
        border: `1px solid ${accent.main}`,
      }}
    >
      <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi, px: 1 }}>Выбрано: {count}</Box>
      {children}
      <Box sx={{ flex: 1 }} />
      <Button size="small" sx={{ color: ink.mid }} onClick={onClear}>Снять выбор</Button>
    </Box>
  );
}
