import { useTranslation } from 'react-i18next';
import Stack from '@mui/material/Stack';
import TranslateIcon from '@mui/icons-material/Translate';

import { SelectField } from '@/components/SelectField';
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

  const field = (
    <SelectField<SupportedLanguage>
      size={size}
      fullWidth={false}
      value={SUPPORTED_LANGUAGES.includes(current) ? current : 'en'}
      onChange={(next) => void i18n.changeLanguage(next)}
      label={compact ? undefined : t('common.language')}
      testId="language-switcher"
      sx={{ minWidth: compact ? 108 : 152 }}
      options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_LABELS[code] }))}
    />
  );

  if (!compact) return field;
  // У SelectField нет адорнмента — значок стоит рядом, а не внутри поля.
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <TranslateIcon fontSize="small" color="action" />
      {field}
    </Stack>
  );
}
