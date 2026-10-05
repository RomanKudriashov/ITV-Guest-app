import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TextField from '@mui/material/TextField';

/**
 * КОММЕНТАРИЙ ГОСТЯ — С ВИДИМЫМ ПРЕДЕЛОМ (партия 31, DEV-10 QA).
 *
 * `maxlength=300` молча останавливал ввод и вставку: длинный текст обрезался
 * без слова, а считались единицы UTF-16 — эмодзи «съедал» два знака. Здесь
 * счётчик «N/300» виден всегда, знаки считаются символами (как сервер:
 * `COMMENT_MAX` в apps/orders/schemas/guest.py), а обрезанная вставка
 * называется прямо.
 */
export const COMMENT_MAX = 300;

const length = (value: string): number => Array.from(value).length;

export interface CommentFieldProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}

export function CommentField({ label, placeholder, value, onChange, testId }: CommentFieldProps) {
  const { t } = useTranslation();
  const [trimmed, setTrimmed] = useState(false);
  const used = length(value);

  return (
    <TextField
      fullWidth
      multiline
      minRows={2}
      label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        if (length(next) > COMMENT_MAX) {
          onChange(Array.from(next).slice(0, COMMENT_MAX).join(''));
          setTrimmed(true);
          return;
        }
        setTrimmed(false);
        onChange(next);
      }}
      error={trimmed}
      helperText={
        <span data-testid={`${testId}-counter`}>
          {trimmed
            ? t('guest.comment.trimmed', { max: COMMENT_MAX, used })
            : t('guest.comment.counter', { max: COMMENT_MAX, used })}
        </span>
      }
      inputProps={{ 'data-testid': testId }}
    />
  );
}
