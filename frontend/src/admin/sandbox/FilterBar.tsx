import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';

import { accent, fieldSx, ink, shape, surface, typo } from '../adminTokens';
import type { Go } from './SandboxApp';
import { Dot, type Tone } from './ui';

/**
 * ПОИСК И ФИЛЬТРЫ — ОДИН ВИД НА ВСЕХ СПИСКАХ (партия 62, второй заход).
 *
 * Поле поиска, фильтр на каждое осмысленное поле (выпадающий список с
 * галочками), выбранные значения — чипами с крестиком и «Сбросить». Всё
 * в адресе: `q` и ключ фильтра со значениями через запятую — ссылка на
 * выборку открывает ту же выборку.
 */

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
}

/** Выбранное из адреса: поиск и значения каждого фильтра. */
export function useFilters(keys: string[], searchKey = 'q') {
  const [params] = useSearchParams();
  const values: Record<string, Set<string>> = {};
  for (const key of keys) values[key] = new Set((params.get(key) ?? '').split(',').filter(Boolean));
  return { q: params.get(searchKey) ?? '', values };
}

/** Проходит ли значение фильтр: пустой фильтр пропускает всё. */
export const passes = (selected: Set<string>, value: string | string[]) =>
  !selected.size || (Array.isArray(value) ? value.some((v) => selected.has(v)) : selected.has(value));

export function FilterBar({
  facets,
  go,
  placeholder,
  searchKey = 'q',
  aside,
}: {
  facets: Facet[];
  go: Go;
  placeholder: string;
  searchKey?: string;
  aside?: ReactNode;
}) {
  const { q, values } = useFilters(facets.map((f) => f.key), searchKey);
  const [menu, setMenu] = useState<{ key: string; el: HTMLElement } | null>(null);
  const [text, setText] = useState(q);

  const set = (key: string, next: Set<string>) => go({ [key]: [...next].join(',') || null }, true);
  const toggle = (key: string, value: string) => {
    const next = new Set(values[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    set(key, next);
  };
  const active = facets.flatMap((f) =>
    [...values[f.key]].map((value) => ({ facet: f, value, label: f.options.find((o) => o.value === value)?.label ?? value })),
  );
  const reset = () => {
    setText('');
    go(Object.fromEntries([[searchKey, null], ...facets.map((f) => [f.key, null])]), true);
  };

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            go({ [searchKey]: e.target.value || null }, true);
          }}
          sx={{ ...fieldSx, width: { xs: '100%', md: 320 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', maxWidth: '100%', pb: { xs: 0.5, md: 0 }, scrollbarWidth: 'none' }}>
          {facets.map((f) => {
            const n = values[f.key].size;
            return (
              <ButtonBase
                key={f.key}
                onClick={(e) => setMenu({ key: f.key, el: e.currentTarget })}
                data-testid={`sandbox-facet-${f.key}`}
                sx={{
                  height: 32,
                  px: 1.5,
                  gap: 0.5,
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

      {active.length || q ? (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mt: 1 }} data-testid="sandbox-active-filters">
          {q ? <ActiveChip label={`Поиск: «${q}»`} onRemove={() => { setText(''); go({ [searchKey]: null }, true); }} /> : null}
          {active.map(({ facet, value, label }) => (
            <ActiveChip key={`${facet.key}:${value}`} label={`${facet.label}: ${label}`} onRemove={() => toggle(facet.key, value)} />
          ))}
          <ButtonBase onClick={reset} sx={{ ...typo.caption, fontWeight: 700, color: accent.soft, px: 1, py: 0.5 }}>
            Сбросить
          </ButtonBase>
        </Box>
      ) : null}

      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {facets
          .find((f) => f.key === menu?.key)
          ?.options.map((o) => (
            <MenuItem key={o.value} onClick={() => toggle(menu!.key, o.value)} dense>
              <Checkbox size="small" checked={values[menu!.key].has(o.value)} sx={{ p: 0.5, mr: 1 }} />
              {o.tone ? <Box sx={{ mr: 1, display: 'inline-flex' }}><Dot tone={o.tone} /></Box> : null}
              <ListItemText primary={o.label} />
              {o.count != null ? <Box sx={{ ml: 2, color: ink.low, ...typo.caption }}>{o.count}</Box> : null}
            </MenuItem>
          ))}
      </Menu>
    </Box>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Box
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
      <ButtonBase onClick={onRemove} aria-label={`Убрать: ${label}`} sx={{ borderRadius: '50%', p: 0.25 }}>
        <CloseIcon sx={{ fontSize: 15 }} />
      </ButtonBase>
    </Box>
  );
}
