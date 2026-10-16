import { useTranslation } from 'react-i18next';
import Stack from '@mui/material/Stack';
import TranslateOutlinedIcon from '@mui/icons-material/TranslateOutlined';

import { SelectField } from '@/components/SelectField';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';

export interface LanguageSwitcherProps {
  size?: 'small' | 'medium';
  /** Renders without the leading icon (used in tight toolbars). */
  compact?: boolean;
}

const LONGEST_LABEL = Math.max(...SUPPORTED_LANGUAGES.map((code) => LANGUAGE_LABELS[code].length));

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
      // Ширина — от самой длинной подписи (×1.2: кириллица шире «0», по которой
      // считается `ch`) плюс стрелка и поля (~56 px):
      // фиксированные 108 оставляли тексту 63 px, и «Русский» читался
      // «Русск…» на всех экранах (регрессия партии 54, найдена аудитом 55).
      sx={{ minWidth: `calc(${(LONGEST_LABEL * 1.2).toFixed(1)}ch + ${compact ? 56 : 64}px)` }}
      options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_LABELS[code] }))}
    />
  );

  if (!compact) return field;
  // У SelectField нет адорнмента — значок стоит рядом, а не внутри поля.
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <TranslateOutlinedIcon fontSize="small" color="action" />
      {field}
    </Stack>
  );
}
