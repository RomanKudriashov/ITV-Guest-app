import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { SearchField } from '@/components/SearchField';
import { accent, fieldSx, ink, panelSx, pillSx, shape, state, surface, typo } from '../../adminTokens';
import type { GroupColor } from '../../adminClient';

/**
 * ДЕТАЛИ ЭКРАНА «ОТЕЛИ» (партия 62-A1) — по макету песочницы, из словаря
 * консоли, без своих цветов.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'gold' | 'muted';

export const groupColorVar = (c: GroupColor) => (c === 'accent' ? accent.main : state[c]);

/** Цветная метка группы — та же в заголовке группы, в списке и в окнах. */
export function GroupMark({ color, size = 12 }: { color: GroupColor; size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: 'inline-block', width: size, height: size, borderRadius: '4px', bgcolor: groupColorVar(color), flex: '0 0 auto' }}
    />
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', bgcolor: tone === 'muted' ? ink.low : state[tone] }}
    />
  );
}

export function Pill({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return (
    <Box component="span" sx={pillSx(tone)} data-testid={testId}>
      {children}
    </Box>
  );
}

/** Значок «?» с подробностью: наведение на компьютере, касание на телефоне. */
export function Help({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Tooltip title={<Box sx={{ ...typo.caption, p: 0.5 }}>{children}</Box>} enterTouchDelay={0} leaveTouchDelay={6000} arrow>
      <Box
        component="span"
        tabIndex={0}
        role="button"
        aria-label={t('admin.hotels.more')}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          ml: 0.5,
          borderRadius: '50%',
          border: `1px solid ${surface.line}`,
          color: ink.mid,
          fontSize: 11,
          fontWeight: 700,
          cursor: 'help',
          verticalAlign: 'middle',
          textTransform: 'none',
          letterSpacing: 0,
        }}
      >
        ?
      </Box>
    </Tooltip>
  );
}

/**
 * Поле или выключатель с «?» рядом (партия 62-F): у каждой настройки Control
 * есть пояснение — что она меняет и для кого.
 */
export function WithHelp({ help, children, testId }: { help: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, minWidth: 0 }} data-testid={testId}>
      {children}
      <Help>{help}</Help>
    </Box>
  );
}

/** Строка под полем: короткое пояснение и «?» с подробностью. */
export function HelpLine({ text, help }: { text: ReactNode; help: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
      {text}
      <Help>{help}</Help>
    </Box>
  );
}

/** Подсветка найденного куска текста. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box
        component="mark"
        data-hl=""
        sx={{ bgcolor: 'var(--adm-state-gold-wash)', color: 'inherit', borderRadius: '3px', px: '1px', outline: `1px solid ${state.gold}` }}
      >
        {text.slice(at, at + q.length)}
      </Box>
      {text.slice(at + q.length)}
    </>
  );
}

export function Empty({ title, children, action, testId = 'admin-hotels-empty' }: { title: string; children?: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 4, px: 2 }} data-testid={testId}>
      <Typography sx={{ ...typo.panelTitle, color: ink.hi }}>{title}</Typography>
      {children ? <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.75, maxWidth: 520, mx: 'auto' }}>{children}</Typography> : null}
      {action ? <Box sx={{ mt: 2 }}>{action}</Box> : null}
    </Box>
  );
}

export function ViewSwitch<K extends string>({
  options,
  value,
  onChange,
  label,
  testIdPrefix = 'admin-hotels-layout',
}: {
  options: Array<[K, string, ReactNode?]>;
  value: K;
  onChange: (key: K) => void;
  label: string;
  testIdPrefix?: string;
}) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'inline-flex', p: 0.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2, border: `1px solid ${surface.line}`, flex: '0 0 auto' }}>
      {options.map(([key, text, icon]) => (
        <ButtonBase
          key={key}
          aria-pressed={value === key}
          data-testid={`${testIdPrefix}-${key}`}
          onClick={() => onChange(key)}
          sx={{
            gap: 0.75,
            px: 1.25,
            py: 0.6,
            borderRadius: `${shape.radiusSmall}px`,
            ...typo.caption,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            color: value === key ? accent.soft : ink.mid,
            bgcolor: value === key ? accent.wash : 'transparent',
          }}
        >
          {icon}
          {text}
        </ButtonBase>
      ))}
    </Box>
  );
}

/* ── Поиск и фильтры: всё в адресе ──────────────────────────────────────── */

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
  tone?: Tone;
}
export interface Facet {
  key: string;
  label: string;
  options: FacetOption[];
  /**
   * Слово для выбранного значения, которого нет среди вариантов: выдача
   * пустая, справочник ещё грузится, значение пришло ссылкой. Без него чип
   * показал бы код из адреса («Что: modules») — партия 62-E1.
   */
  describe?: (value: string) => string;
}

/** Выбранное из адреса: значения фильтров через запятую. */
export function useFacetValues(keys: string[]): Record<string, string[]> {
  const [params] = useSearchParams();
  return Object.fromEntries(keys.map((k) => [k, (params.get(k) ?? '').split(',').filter(Boolean)]));
}

/**
 * Поиск, фильтр на каждое поле (выпадающий список с галочками), выбранное —
 * чипами с крестиком и «Сбросить». Пишет в адрес с `replace`: набранная
 * буква не должна становиться шагом истории.
 */
export function FilterBar({ facets, placeholder, aside }: { facets: Facet[]; placeholder: string; aside?: ReactNode }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const values = useFacetValues(facets.map((f) => f.key));
  const search = params.get('search') ?? '';
  const [menu, setMenu] = useState<{ key: string; el: HTMLElement } | null>(null);

  const write = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const toggle = (key: string, value: string) => {
    const now = new Set(values[key]);
    if (now.has(value)) now.delete(value);
    else now.add(value);
    write({ [key]: [...now].join(',') || null });
  };
  const active = facets.flatMap((f) =>
    values[f.key].map((value) => ({
      facet: f,
      value,
      label: f.options.find((o) => o.value === value)?.label ?? f.describe?.(value) ?? t('admin.hotels.filter.unknownValue'),
    })),
  );

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchField
          value={search}
          onChange={(value) => write({ search: value || null })}
          placeholder={placeholder}
          testId="admin-fleet-search"
          sx={[fieldSx, { width: { xs: '100%', md: 320 } }]}
        />
        <Box sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', maxWidth: '100%', pb: { xs: 0.5, md: 0 }, scrollbarWidth: 'none' }}>
          {facets.map((f) => {
            const n = values[f.key].length;
            return (
              <ButtonBase
                key={f.key}
                onClick={(e) => setMenu({ key: f.key, el: e.currentTarget })}
                data-testid={`admin-hotels-facet-${f.key}`}
                sx={{
                  height: 32,
                  px: 1.5,
                  flex: '0 0 auto',
                  borderRadius: `${shape.pill}px`,
                  ...typo.caption,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  border: `1px solid ${n ? accent.main : surface.line}`,
                  bgcolor: n ? accent.washSoft : surface.s2,
                  color: n ? accent.soft : ink.mid,
                }}
              >
                {f.label}
                {n ? ` · ${n}` : ''} ▾
              </ButtonBase>
            );
          })}
        </Box>
        {aside ? <Box sx={{ ml: { md: 'auto' } }}>{aside}</Box> : null}
      </Box>

      {active.length || search ? (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mt: 1 }} data-testid="admin-hotels-active-filters">
          {search ? <ActiveChip label={t('admin.hotels.filter.searchChip', { text: search })} onRemove={() => write({ search: null })} /> : null}
          {active.map(({ facet, value, label }) => (
            <ActiveChip key={`${facet.key}:${value}`} testId={`admin-hotels-chip-${facet.key}-${value}`} label={`${facet.label}: ${label}`} onRemove={() => toggle(facet.key, value)} />
          ))}
          <ButtonBase
            data-testid="admin-hotels-reset"
            onClick={() => write(Object.fromEntries([['search', null], ...facets.map((f) => [f.key, null])]))}
            sx={{ ...typo.caption, fontWeight: 700, color: accent.soft, px: 1, py: 0.5 }}
          >
            {t('admin.hotels.filter.reset')}
          </ButtonBase>
        </Box>
      ) : null}

      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {facets
          .find((f) => f.key === menu?.key)
          ?.options.map((o) => (
            <MenuItem key={o.value} onClick={() => toggle(menu!.key, o.value)} dense data-testid={`admin-hotels-option-${menu!.key}-${o.value}`}>
              <Checkbox size="small" checked={values[menu!.key].includes(o.value)} sx={{ p: 0.5, mr: 1 }} />
              {o.tone ? <Box sx={{ mr: 1, display: 'inline-flex' }}><Dot tone={o.tone} /></Box> : null}
              <ListItemText primary={o.label} />
              {o.count != null ? <Box sx={{ ml: 2, color: ink.low, ...typo.caption }}>{o.count}</Box> : null}
            </MenuItem>
          ))}
      </Menu>
    </Box>
  );
}

function ActiveChip({ label, onRemove, testId }: { label: string; onRemove: () => void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        pl: 1.25,
        pr: 0.5,
        height: 28,
        borderRadius: `${shape.pill}px`,
        bgcolor: accent.washSoft,
        border: `1px solid ${accent.main}`,
        color: accent.soft,
        ...typo.caption,
        fontWeight: 600,
      }}
    >
      {label}
      <ButtonBase onClick={onRemove} aria-label={t('admin.hotels.filter.remove', { label })} sx={{ borderRadius: '50%', p: 0.25 }}>
        <CloseIcon sx={{ fontSize: 15 }} />
      </ButtonBase>
    </Box>
  );
}

/** Карточка цифры: подпись, число, пояснение. */
export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <Box sx={{ ...panelSx, minWidth: 0 }}>
      <Typography sx={{ ...typo.label, color: ink.mid }}>{label}</Typography>
      <Typography sx={{ ...typo.metric, color: tone && tone !== 'muted' ? state[tone] : ink.hi, mt: 0.75 }}>{value}</Typography>
      {hint ? <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>{hint}</Typography> : null}
    </Box>
  );
}

/** Панель с заголовком и местом справа от него. */
export function Panel({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={panelSx}>
      {title ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <Typography component="h2" sx={{ ...typo.panelTitle, color: ink.hi, flex: '1 1 auto' }}>{title}</Typography>
          {aside}
        </Box>
      ) : null}
      {children}
    </Box>
  );
}
