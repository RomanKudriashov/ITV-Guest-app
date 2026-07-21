import { useTranslation } from 'react-i18next';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import TranslateIcon from '@mui/icons-material/Translate';
import InputAdornment from '@mui/material/InputAdornment';

import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';

export interface LanguageSwitcherProps {
  size?: 'small' | 'medium';
  /** Renders without the leading icon (used in tight toolbars). */
  compact?: boolean;
}

/** Switches the *interface* language (content languages come from bootstrap). */
export function LanguageSwitcher({ size = 'small', compact = false }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as SupportedLanguage;

  return (
    <TextField
      select
      size={size}
      value={SUPPORTED_LANGUAGES.includes(current) ? current : 'en'}
      onChange={(event) => void i18n.changeLanguage(event.target.value)}
      label={compact ? undefined : t('common.language')}
      data-testid="language-switcher"
      sx={{ minWidth: compact ? 108 : 152 }}
      InputProps={
        compact
          ? {
              startAdornment: (
                <InputAdornment position="start">
                  <TranslateIcon fontSize="small" />
                </InputAdornment>
              ),
            }
          : undefined
      }
    >
      {SUPPORTED_LANGUAGES.map((code) => (
        <MenuItem key={code} value={code}>
          {LANGUAGE_LABELS[code]}
        </MenuItem>
      ))}
    </TextField>
  );
}
