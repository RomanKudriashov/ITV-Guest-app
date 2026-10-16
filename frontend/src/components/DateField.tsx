import { type ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/ru';
import 'dayjs/locale/ar';
import 'dayjs/locale/zh-cn';

/**
 * ДАТА И ВРЕМЯ — ОДНИМ КОМПОНЕНТОМ, А НЕ СИСТЕМНЫМ ПОЛЕМ БРАУЗЕРА (партия 55).
 *
 * `<input type="date">` рисует браузер: формат, календарь и даже высота поля
 * зависят от системы и языка ОС, а не интерфейса — у оператора с английской
 * системой русский экран показывал «mm/dd/yyyy». Здесь — MUI X Date Pickers
 * (`@mui/x-date-pickers` v7, адаптер dayjs): тот же вид, что у остальных
 * полей, формат всегда дд.мм.гггг, названия месяцев и дней — на языке
 * интерфейса (ru, en, ar, zh), календарь зеркалится в арабском.
 *
 * Значение — СТРОКОЙ, как у системного поля: `YYYY-MM-DD` у даты, `HH:mm` у
 * времени, пусто — ''. Так замена не трогает код вокруг: API и фильтры
 * получают ровно то, что получали.
 */

const DAYJS_LOCALE: Record<string, string> = { ru: 'ru', en: 'en', ar: 'ar', zh: 'zh-cn' };

function useAdapterLocale(): string {
  const { i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
  return DAYJS_LOCALE[lang] ?? 'en';
}

interface CommonProps {
  label?: ReactNode;
  testId?: string;
  helperText?: ReactNode;
  error?: boolean;
  disabled?: boolean;
  required?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  name?: string;
}

export interface DateFieldProps extends CommonProps {
  /** `YYYY-MM-DD` или ''. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}

const DATE_VALUE = 'YYYY-MM-DD';
const DATE_SHOWN = 'DD.MM.YYYY';

export function DateField({ value, onChange, min, max, label, testId, helperText, error, disabled, required, size, fullWidth, sx, name }: DateFieldProps) {
  const locale = useAdapterLocale();
  // ISO-строку dayjs читает сам — плагин разбора форматов не нужен.
  const parsed = value ? dayjs(value) : null;
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
      <DatePicker<Dayjs>
        value={parsed && parsed.isValid() ? parsed : null}
        onChange={(next) => onChange(next && next.isValid() ? next.format(DATE_VALUE) : '')}
        format={DATE_SHOWN}
        minDate={min ? dayjs(min) : undefined}
        maxDate={max ? dayjs(max) : undefined}
        disabled={disabled}
        label={label}
        sx={sx}
        slotProps={{
          textField: {
            size,
            fullWidth,
            name,
            required,
            error,
            helperText,
            inputProps: { 'data-testid': testId, 'data-value': value },
          },
          field: { clearable: true },
        }}
      />
    </LocalizationProvider>
  );
}

export interface TimeFieldProps extends CommonProps {
  /** `HH:mm` или ''. */
  value: string;
  onChange: (value: string) => void;
}

const TIME_VALUE = 'HH:mm';

export function TimeField({ value, onChange, label, testId, helperText, error, disabled, required, size, fullWidth, sx, name }: TimeFieldProps) {
  const locale = useAdapterLocale();
  const parsed = value ? dayjs(`2000-01-01T${value}`) : null;
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
      <TimePicker<Dayjs>
        value={parsed && parsed.isValid() ? parsed : null}
        onChange={(next) => onChange(next && next.isValid() ? next.format(TIME_VALUE) : '')}
        format={TIME_VALUE}
        ampm={false}
        disabled={disabled}
        label={label}
        sx={sx}
        slotProps={{
          textField: {
            size,
            fullWidth,
            name,
            required,
            error,
            helperText,
            inputProps: { 'data-testid': testId, 'data-value': value },
          },
        }}
      />
    </LocalizationProvider>
  );
}
