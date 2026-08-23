import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useTranslation } from 'react-i18next';

import type { TrackerAssignee } from '../api/types';

/**
 * ПАНЕЛЬ ФИЛЬТРОВ ДОСКИ.
 *
 * Доска показывала всё, что есть у точки, и в час пик официант искал глазами,
 * что ещё не взято, а управляющий — что висит на конкретном человеке.
 *
 * Панелью ПО КНОПКЕ, а не постоянной полосой: фильтрами пользуются несколько
 * раз за смену, а место на доске отнимали бы всегда. Число на кнопке говорит,
 * сколько фильтров включено, — иначе свёрнутая панель прячет то, что доска
 * показывает не всё, и человек ищет пропавший заказ.
 *
 * Состояние — В АДРЕСЕ, рядом с поиском: ссылку с выборкой посылают коллеге, и
 * он обязан увидеть ТО ЖЕ САМОЕ. Сужает СЕРВЕР — отсев уже полученной доски
 * соврал бы на первом же заказе, который не приехал.
 *
 * «Только просроченные» — ТОТ ЖЕ параметр, что за плиткой «просрочено».
 * Два ответа на один вопрос однажды разойдутся, поэтому ответ один, а входа
 * в него два, и они видимо согласованы: включил галку — подсветилась плитка.
 */

export interface BoardFilterValues {
  mine: string;
  unassigned: string;
  overdue: string;
  assignee: string;
  order_type: string;
}

export interface BoardFiltersProps {
  open: boolean;
  onToggle: () => void;
  values: BoardFilterValues;
  onChange: (next: Partial<BoardFilterValues>) => void;
  onReset: () => void;
  assignees: TrackerAssignee[];
  activeCount: number;
}

export function BoardFilters({
  open,
  onToggle,
  values,
  onChange,
  onReset,
  assignees,
  activeCount,
}: BoardFiltersProps) {
  const { t } = useTranslation();
  const flag = (value: string) => value === '1';

  return (
    <Box sx={{ px: { xs: 1.5, md: 2 }, pt: 1 }}>
      <Badge badgeContent={activeCount} color="primary">
        <Button
          size="small"
          variant={open ? 'contained' : 'outlined'}
          startIcon={<FilterListIcon />}
          onClick={onToggle}
          data-testid="tracker-filters-toggle"
          aria-expanded={open}
          sx={{ minHeight: 44 }}
        >
          {t('tracker.filters.button')}
        </Button>
      </Badge>

      <Collapse in={open} unmountOnExit>
        <Box
          data-testid="tracker-filters-panel"
          sx={{ mt: 1, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}
        >
          <Stack spacing={1}>
            <Stack direction="row" flexWrap="wrap" useFlexGap columnGap={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={flag(values.mine)}
                    onChange={(event) =>
                      // «Мои» и «ничьи» вместе дали бы пустую доску всегда:
                      // взятое мной по определению не ничьё. Включаем одно.
                      onChange({
                        mine: event.target.checked ? '1' : '',
                        ...(event.target.checked ? { unassigned: '' } : {}),
                      })
                    }
                    inputProps={{ 'data-testid': 'tracker-filter-mine' } as never}
                  />
                }
                label={t('tracker.filters.mine')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={flag(values.unassigned)}
                    onChange={(event) =>
                      onChange({
                        unassigned: event.target.checked ? '1' : '',
                        ...(event.target.checked ? { mine: '', assignee: '' } : {}),
                      })
                    }
                    inputProps={{ 'data-testid': 'tracker-filter-unassigned' } as never}
                  />
                }
                label={t('tracker.filters.unassigned')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={flag(values.overdue)}
                    onChange={(event) => onChange({ overdue: event.target.checked ? '1' : '' })}
                    inputProps={{ 'data-testid': 'tracker-filter-overdue' } as never}
                  />
                }
                label={t('tracker.filters.overdue')}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                select
                size="small"
                fullWidth
                label={t('tracker.filters.assignee')}
                value={values.assignee}
                disabled={flag(values.unassigned)}
                onChange={(event) => onChange({ assignee: event.target.value, mine: '' })}
                // Метку вешаем на ВИДИМУЮ часть селекта: `inputProps` у MUI
                // садится на скрытый нативный input, по которому не кликнуть.
                SelectProps={{
                  SelectDisplayProps: { 'data-testid': 'tracker-filter-assignee' } as never,
                }}
              >
                <MenuItem value="">{t('tracker.filters.anyone')}</MenuItem>
                {assignees.map((person) => (
                  <MenuItem key={person.id} value={person.id}>
                    {person.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                fullWidth
                label={t('tracker.filters.type')}
                value={values.order_type}
                onChange={(event) => onChange({ order_type: event.target.value })}
                SelectProps={{
                  SelectDisplayProps: { 'data-testid': 'tracker-filter-type' } as never,
                }}
              >
                <MenuItem value="">{t('tracker.filters.anyType')}</MenuItem>
                <MenuItem value="cart">{t('tracker.filters.typeCart')}</MenuItem>
                <MenuItem value="request">{t('tracker.filters.typeRequest')}</MenuItem>
              </TextField>
            </Stack>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                size="small"
                onClick={onReset}
                disabled={activeCount === 0}
                data-testid="tracker-filters-reset"
              >
                {t('tracker.filters.reset')}
              </Button>
            </Box>
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}
