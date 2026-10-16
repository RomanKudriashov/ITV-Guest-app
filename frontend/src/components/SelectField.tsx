import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import ArrowDropDownOutlinedIcon from '@mui/icons-material/ArrowDropDownOutlined';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ВЫБОР ИЗ СПИСКА — ОДИН КОМПОНЕНТ НА ВЕСЬ ФРОНТ (партия 54).
 *
 * Было около сотни `TextField select` / `Select` / нативных `<select>`, и ни в
 * одном не было поиска: выбрать отель из флота в «Узлах» или пояс из шестисот
 * значило листать. Здесь — Autocomplete с поиском по подписи, одинаковый для
 * длинных и коротких списков: человек не должен угадывать, где печатать можно.
 *
 * КОНТРАКТ ДЛЯ ПРОВЕРОК. `testId` стоит на поле ввода (role=combobox), рядом —
 * `data-value` с кодом выбранного значения; у каждого варианта в списке —
 * свой `data-value` и, если задан, свой `testId`. Подпись в поле — то, что
 * видит человек, код — в `data-value`: e2e сверяет код, а не перевод.
 *
 * Значение, которого ещё нет в вариантах (список грузится), показывается
 * кодом, а не пустым полем: пустое поле читается как «не выбрано».
 */

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Вторая строка в списке: смещение пояса, код валюты и т.п. */
  secondary?: string;
  disabled?: boolean;
  /** testid варианта в списке (нужен проверкам, что раньше кликали MenuItem). */
  testId?: string;
  /** Заголовок группы в списке; варианты одной группы должны идти подряд. */
  group?: string;
}

interface CommonProps<V extends string> {
  options: ReadonlyArray<SelectOption<V>>;
  label?: ReactNode;
  testId?: string;
  helperText?: ReactNode;
  error?: boolean;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  loading?: boolean;
  noOptionsText?: ReactNode;
  sx?: SxProps<Theme>;
  /** Стиль самого поля (TextField): сюда — общий `fieldSx` консоли. */
  fieldSx?: SxProps<Theme>;
  id?: string;
  name?: string;
  autoFocus?: boolean;
}

export interface SelectFieldProps<V extends string> extends CommonProps<V> {
  value: V | '' | null | undefined;
  onChange: (value: V) => void;
  /** Можно ли очистить крестиком — тогда `onChange('')`. По умолчанию нельзя. */
  clearable?: boolean;
}

function fallback<V extends string>(options: ReadonlyArray<SelectOption<V>>, value: string) {
  return options.find((option) => option.value === value) ?? ({ value, label: value } as SelectOption<V>);
}

export function SelectField<V extends string = string>({
  options,
  value,
  onChange,
  clearable = false,
  label,
  testId,
  helperText,
  error,
  disabled,
  required,
  placeholder,
  size,
  fullWidth = true,
  loading,
  noOptionsText,
  sx,
  fieldSx,
  id,
  name,
  autoFocus,
}: SelectFieldProps<V>) {
  const { t } = useTranslation();
  // '' — законный вариант («все», «нет»), если он есть в списке; иначе — пусто.
  const has = value !== null && value !== undefined && (value !== '' || options.some((o) => o.value === ''));
  const selected = has ? fallback(options, value as string) : null;
  const grouped = options.some((option) => option.group);

  return (
    <Autocomplete<SelectOption<V>, false, boolean, false>
      id={id}
      options={options as SelectOption<V>[]}
      value={selected}
      onChange={(_event, next) => onChange((next?.value ?? '') as V)}
      disableClearable={!clearable}
      openOnFocus
      autoHighlight
      // Стрелка — контурная, как остальные иконки шапки и меню (партия 55).
      popupIcon={<ArrowDropDownOutlinedIcon />}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={loading}
      size={size}
      sx={sx}
      groupBy={grouped ? (option) => option.group ?? '' : undefined}
      getOptionLabel={(option) => option.label}
      getOptionDisabled={(option) => Boolean(option.disabled)}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      // Поиск — и по подписи, и по коду, и по второй строке: «msk», «RUB».
      filterOptions={(list, state) => {
        const query = state.inputValue.trim().toLowerCase();
        if (!query) return list;
        return list.filter((option) =>
          [option.label, option.value, option.secondary ?? ''].some((text) => text.toLowerCase().includes(query)),
        );
      }}
      noOptionsText={noOptionsText ?? t('common.nothingFound')}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest} data-value={option.value} data-testid={option.testId}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{option.label}</span>
            {option.secondary ? (
              <Box component="span" sx={{ color: 'text.secondary', marginInlineStart: 1.5, whiteSpace: 'nowrap' }}>{option.secondary}</Box>
            ) : null}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          name={name}
          required={required}
          error={error}
          helperText={helperText}
          placeholder={placeholder}
          autoFocus={autoFocus}
          sx={fieldSx}
          inputProps={{
            ...params.inputProps,
            'data-testid': testId,
            'data-value': selected?.value ?? '',
          }}
        />
      )}
    />
  );
}

export interface MultiSelectFieldProps<V extends string> extends CommonProps<V> {
  value: ReadonlyArray<V>;
  onChange: (value: V[]) => void;
}

/** То же для нескольких значений: языки отеля, языки баннера. */
export function MultiSelectField<V extends string = string>({
  options,
  value,
  onChange,
  label,
  testId,
  helperText,
  error,
  disabled,
  required,
  placeholder,
  size,
  fullWidth = true,
  loading,
  noOptionsText,
  sx,
  fieldSx,
  id,
  name,
  autoFocus,
}: MultiSelectFieldProps<V>) {
  const { t } = useTranslation();
  const selected = value.map((code) => fallback(options, code));
  return (
    <Autocomplete<SelectOption<V>, true, false, false>
      multiple
      id={id}
      options={options as SelectOption<V>[]}
      value={selected}
      onChange={(_event, next) => onChange(next.map((option) => option.value))}
      openOnFocus
      autoHighlight
      // Стрелка — контурная, как остальные иконки шапки и меню (партия 55).
      popupIcon={<ArrowDropDownOutlinedIcon />}
      disableCloseOnSelect
      fullWidth={fullWidth}
      disabled={disabled}
      loading={loading}
      size={size}
      // ВЫСОТА — КАК У СОСЕДНИХ ПОЛЕЙ (партия 55). Фишки обычного размера
      // (24 px + отступы) раздували поле до 45 px против 32 у соседей в ряду
      // («Новый отель»: «Валюта» и «Языки»). Мелкие фишки по 20 px без
      // вертикальных полей укладываются в строку поля.
      ChipProps={{ size: 'small' }}
      // И в одну строку: фишки, что не влезли, сворачиваются в «+N», пока поле
      // не в фокусе, — иначе узкое поле переносило их и росло до 52 px.
      limitTags={2}
      sx={[
        {
          '& .MuiAutocomplete-tag': { height: 20, my: 0, maxWidth: 'calc(100% - 8px)' },
          '& .MuiAutocomplete-inputRoot:not(.Mui-focused)': { flexWrap: 'nowrap', overflow: 'hidden' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      getOptionLabel={(option) => option.label}
      getOptionDisabled={(option) => Boolean(option.disabled)}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      filterOptions={(list, state) => {
        const query = state.inputValue.trim().toLowerCase();
        if (!query) return list;
        return list.filter((option) =>
          [option.label, option.value, option.secondary ?? ''].some((text) => text.toLowerCase().includes(query)),
        );
      }}
      noOptionsText={noOptionsText ?? t('common.nothingFound')}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest} data-value={option.value} data-testid={option.testId}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{option.label}</span>
            {option.secondary ? (
              <Box component="span" sx={{ color: 'text.secondary', marginInlineStart: 1.5, whiteSpace: 'nowrap' }}>{option.secondary}</Box>
            ) : null}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          name={name}
          required={required}
          error={error}
          helperText={helperText}
          placeholder={placeholder}
          autoFocus={autoFocus}
          sx={fieldSx}
          inputProps={{
            ...params.inputProps,
            'data-testid': testId,
            'data-value': value.join(','),
          }}
        />
      )}
    />
  );
}
