import { useCallback, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useTranslation } from 'react-i18next';

import { SelectField } from '@/components/SelectField';
import { accent, ink, surface, typo } from './adminTokens';

/**
 * СОРТИРОВКА В CONTROL (партия 62-F) — одна на все таблицы и списки.
 *
 * Состояние — в адресе (`sort`, `dir`; у второй таблицы на экране — с
 * приставкой), ссылка открывает тот же порядок. Клик по заголовку: ↑, ещё раз
 * ↓, третий — сброс к порядку по умолчанию. Заголовок — кнопка: клавиатура,
 * `aria-sort`. На телефоне таблиц нет — над карточками «Сортировать по».
 *
 * Правила сравнения — здесь, чтобы не разъехаться по экранам:
 *   * текст — по-русски, без регистра, «ё» = «е»;
 *   * номера — «по-человечески»: 2 < 10 < 101, «3А» после «3»;
 *   * числа как числа, даты как даты;
 *   * пустые — всегда в конце, в какую сторону ни сортируй;
 *   * состояния — по важности (`rank`: порядок значений от «хуже» к «лучше»);
 *   * при равенстве — второй ключ (`then`), затем исходный порядок.
 *
 * Постраничные выдачи сортирует СЕРВЕР (`apps.core.sorting`): здесь тогда
 * только заголовки и адрес, порядок строк не трогается (`server: true`).
 */

export type SortDir = 'asc' | 'desc';
export type SortKind = 'text' | 'natural' | 'number' | 'date' | 'rank';

export interface SortColumn<R> {
  key: string;
  label: string;
  kind: SortKind;
  /** Значение строки для сравнения; `null`/`undefined`/'' — пусто, в конец. */
  get?: (row: R) => unknown;
  /** Для `rank`: значения от «самого важного» к «самому спокойному». */
  rank?: readonly string[];
}

export interface SortState {
  sort: string;
  dir: SortDir;
  /** Клик по заголовку: ↑ → ↓ → сброс. */
  toggle: (key: string) => void;
  set: (key: string, dir: SortDir) => void;
  clear: () => void;
  /** Параметры для сервера: `{sort, dir}` или пусто. */
  query: { sort?: string; dir?: SortDir };
}

/** Сортировка таблицы из адреса. `prefix` — для второй таблицы на экране. */
export function useSort(prefix = '', allowed?: readonly string[]): SortState {
  const [params, setParams] = useSearchParams();
  const sortKey = `${prefix}sort`;
  const dirKey = `${prefix}dir`;
  const raw = params.get(sortKey) ?? '';
  const sort = allowed && !allowed.includes(raw) ? '' : raw;
  const dir: SortDir = params.get(dirKey) === 'desc' ? 'desc' : 'asc';

  const write = useCallback(
    (key: string, next: SortDir | null) => {
      const copy = new URLSearchParams(params);
      if (next && key) {
        copy.set(sortKey, key);
        copy.set(dirKey, next);
      } else {
        copy.delete(sortKey);
        copy.delete(dirKey);
      }
      // Курсор старой выдачи к новому порядку не подходит.
      copy.delete(`${prefix}cursor`);
      setParams(copy, { replace: true });
    },
    [params, setParams, sortKey, dirKey, prefix],
  );

  return {
    sort,
    dir,
    toggle: (key) => {
      if (sort !== key) write(key, 'asc');
      else if (dir === 'asc') write(key, 'desc');
      else write('', null);
    },
    set: (key, next) => write(key, next),
    clear: () => write('', null),
    query: sort ? { sort, dir } : {},
  };
}

const COLLATOR = new Intl.Collator('ru', { sensitivity: 'base', numeric: false });
const NATURAL = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
const yo = (value: unknown) => String(value).replace(/ё/g, 'е').replace(/Ё/g, 'Е');

/** Сравнение двух непустых значений по виду столбца, по возрастанию. */
export function compareValues(kind: SortKind, a: unknown, b: unknown, rank?: readonly string[]): number {
  switch (kind) {
    case 'number':
      return Number(a) - Number(b);
    case 'date':
      return new Date(String(a)).getTime() - new Date(String(b)).getTime();
    case 'rank': {
      const order = rank ?? [];
      const at = (v: unknown) => {
        const i = order.indexOf(String(v));
        return i < 0 ? order.length : i;
      };
      return at(a) - at(b);
    }
    case 'natural':
      return NATURAL.compare(yo(a), yo(b));
    default:
      return COLLATOR.compare(yo(a), yo(b));
  }
}

/**
 * Отсортировать строки на клиенте. Пустые — в конце всегда; при равенстве —
 * столбец `then`, затем исходный порядок (сортировка устойчивая).
 */
export function sortRows<R>(rows: readonly R[], columns: readonly SortColumn<R>[], state: Pick<SortState, 'sort' | 'dir'>, then?: string): R[] {
  const column = columns.find((c) => c.key === state.sort);
  if (!column) return [...rows];
  const second = columns.find((c) => c.key === then && c.key !== column.key);
  const sign = state.dir === 'desc' ? -1 : 1;
  const value = (c: SortColumn<R>, row: R) => (c.get ? c.get(row) : (row as Record<string, unknown>)[c.key]);
  const by = (c: SortColumn<R>, x: R, y: R, signed: number) => {
    const a = value(c, x);
    const b = value(c, y);
    if (isEmpty(a) && isEmpty(b)) return 0;
    if (isEmpty(a)) return 1;
    if (isEmpty(b)) return -1;
    return signed * compareValues(c.kind, a, b, c.rank);
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => by(column, x.row, y.row, sign) || (second ? by(second, x.row, y.row, 1) : 0) || x.index - y.index)
    .map((entry) => entry.row);
}

/** Заголовок столбца, который сортирует: кнопка, `aria-sort`, стрелка у активного. */
export function SortHeader({
  column,
  state,
  testId,
  align,
  caps = true,
  children,
}: {
  column: { key: string; label: string };
  /**
   * Заглавными, как подписи столбцов Control. В таблицах оборудования (общие
   * с панелью отеля) — как есть: там в заголовках имена вроде «iRidi», и
   * «IRIDI» было бы чужим словом (партия 62-F, сторож слов).
   */
  caps?: boolean;
  state: Pick<SortState, 'sort' | 'dir' | 'toggle'>;
  testId?: string;
  align?: 'left' | 'right';
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const active = state.sort === column.key;
  const ariaSort = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <Box
      component="th"
      aria-sort={ariaSort}
      data-sort-key={column.key}
      sx={{ textAlign: align ?? 'left', p: 0, borderBottom: `1px solid ${surface.line}`, whiteSpace: 'nowrap' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <ButtonBase
          onClick={() => state.toggle(column.key)}
          data-testid={testId ?? `sort-${column.key}`}
          aria-label={t('admin.sort.by', { column: column.label })}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1.25,
            py: 1,
            ...typo.label,
            ...(caps ? {} : { textTransform: 'none', letterSpacing: 0 }),
            color: active ? accent.soft : ink.mid,
            borderRadius: 1,
          }}
        >
          {column.label}
          {active ? (
            state.dir === 'asc' ? <ArrowUpwardIcon sx={{ fontSize: 14 }} /> : <ArrowDownwardIcon sx={{ fontSize: 14 }} />
          ) : (
            <Box component="span" aria-hidden sx={{ width: 14 }} />
          )}
        </ButtonBase>
        {/* «?» — рядом с кнопкой, а не внутри: щелчок по нему не сортирует. */}
        {children}
      </Box>
    </Box>
  );
}

/** Заголовок столбца, который НЕ сортируется (флажки, действия): так и помечен. */
export function PlainHeader({ children, align }: { children?: ReactNode; align?: 'left' | 'right' }) {
  return (
    <Box
      component="th"
      data-sort="none"
      sx={{ ...typo.label, color: ink.mid, textAlign: align ?? 'left', px: 1.25, py: 1, borderBottom: `1px solid ${surface.line}`, whiteSpace: 'nowrap' }}
    >
      {children}
    </Box>
  );
}

/**
 * «Сортировать по» — над карточками на телефоне (и над списками без
 * заголовков). Значение — «столбец, направление»; «по умолчанию» — сброс.
 */
export function SortBar({ columns, state, testId = 'admin-sort-bar' }: { columns: readonly { key: string; label: string }[]; state: SortState; testId?: string }) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { value: '', label: t('admin.sort.default') },
      ...columns.flatMap((c) => [
        { value: `${c.key}:asc`, label: `${c.label} ↑` },
        { value: `${c.key}:desc`, label: `${c.label} ↓` },
      ]),
    ],
    [columns, t],
  );
  return (
    <SelectField
      size="small"
      fullWidth={false}
      sx={{ minWidth: 220 }}
      label={t('admin.sort.label')}
      value={state.sort ? `${state.sort}:${state.dir}` : ''}
      onChange={(value: string) => {
        if (!value) state.clear();
        else {
          const [key, dir] = value.split(':');
          state.set(key, dir === 'desc' ? 'desc' : 'asc');
        }
      }}
      testId={testId}
      options={options}
    />
  );
}
