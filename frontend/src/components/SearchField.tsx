import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * ПОИСК — ОДИН ВИД НА ВСЕХ ЭКРАНАХ (партия 55).
 *
 * Правило полей: у поля ввода подпись на рамке, у поиска — лупа и подсказка
 * внутри, без подписи. Раньше поиск выглядел по-разному: где подсказкой, где
 * подписью, где подписью и подсказкой сразу, — и в одной форме с полями с
 * подписью читался как ещё одно поле, а не как поиск.
 */
export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  autoFocus?: boolean;
  sx?: SxProps<Theme>;
  /** Подпись для экранного диктора — подсказка внутри исчезает при вводе. */
  ariaLabel?: string;
  /** Клавиатура телефона: трекер ищет по номеру заказа — цифровая. */
  inputMode?: 'text' | 'numeric' | 'search';
}

export function SearchField({ value, onChange, placeholder, testId, size = 'small', fullWidth, autoFocus, sx, ariaLabel, inputMode }: SearchFieldProps) {
  return (
    <TextField
      type="search"
      size={size}
      fullWidth={fullWidth}
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      sx={sx}
      inputProps={{ 'data-testid': testId, 'aria-label': ariaLabel ?? placeholder, inputMode }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchOutlinedIcon fontSize="small" />
          </InputAdornment>
        ),
      }}
    />
  );
}
