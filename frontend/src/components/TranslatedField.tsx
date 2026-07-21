import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import type { Translated } from '@/api/types';
import { filledLanguages } from '@/utils/translated';

export interface TranslatedFieldProps {
  label: string;
  value: Translated;
  onChange: (next: Translated) => void;
  /** Content languages from bootstrap. */
  languages: string[];
  languageLabels: Record<string, string>;
  /** Hotel default language — required, marked with an asterisk. */
  defaultLanguage: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  error?: string;
  helperText?: string;
  testId?: string;
  /** Shared tab index so title/description switch language together. */
  activeLanguage?: string;
  onActiveLanguageChange?: (language: string) => void;
}

/**
 * A translatable text field with one tab per content language and an indicator
 * showing which languages are already filled in.
 */
export function TranslatedField({
  label,
  value,
  onChange,
  languages,
  languageLabels,
  defaultLanguage,
  required = false,
  multiline = false,
  rows = 4,
  error,
  helperText,
  testId,
  activeLanguage,
  onActiveLanguageChange,
}: TranslatedFieldProps) {
  const { t } = useTranslation();
  const [internalLanguage, setInternalLanguage] = useState(
    languages.includes(defaultLanguage) ? defaultLanguage : languages[0],
  );
  const current =
    activeLanguage && languages.includes(activeLanguage) ? activeLanguage : internalLanguage;
  const filled = filledLanguages(value);

  const setLanguage = (next: string) => {
    setInternalLanguage(next);
    onActiveLanguageChange?.(next);
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {label}
          {required ? ' *' : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('editor.translationsFilled', {
            filled: filled.length,
            total: languages.length,
          })}
        </Typography>
      </Stack>

      <Tabs
        value={current}
        onChange={(_, next: string) => setLanguage(next)}
        variant="scrollable"
        scrollButtons={false}
        sx={{ minHeight: 36, mb: 1, '& .MuiTab-root': { minHeight: 36, py: 0 } }}
        data-testid={testId ? `${testId}-tabs` : undefined}
      >
        {languages.map((code) => (
          <Tab
            key={code}
            value={code}
            data-testid={testId ? `${testId}-tab-${code}` : undefined}
            label={
              <Badge
                variant="dot"
                color="success"
                invisible={!filled.includes(code)}
                sx={{ '& .MuiBadge-dot': { right: -6, top: 4 } }}
              >
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <span>{languageLabels[code] ?? code.toUpperCase()}</span>
                  {code === defaultLanguage ? (
                    <CheckCircleIcon
                      sx={{ fontSize: 12, color: 'text.secondary', opacity: 0.6 }}
                    />
                  ) : null}
                </Stack>
              </Badge>
            }
          />
        ))}
      </Tabs>

      <TextField
        fullWidth
        size="small"
        multiline={multiline}
        minRows={multiline ? rows : undefined}
        value={value[current] ?? ''}
        onChange={(event) => onChange({ ...value, [current]: event.target.value })}
        error={Boolean(error)}
        helperText={error ?? helperText}
        inputProps={testId ? { 'data-testid': testId, 'data-language': current } : undefined}
      />
    </Box>
  );
}
