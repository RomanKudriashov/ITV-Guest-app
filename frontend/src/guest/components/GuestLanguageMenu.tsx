import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TranslateIcon from '@mui/icons-material/Translate';
import { useTranslation } from 'react-i18next';

import { FLAG_FOR_LANGUAGE, FlagIcon } from '@/kit';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';

/**
 * Compact language picker for the guest header (the CMS one is a select).
 * Each language carries its vector flag; the trigger shows
 * the active language's flag. No emoji flags.
 */
export function GuestLanguageMenu() {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
  const currentFlag = FLAG_FOR_LANGUAGE[current];

  return (
    <>
      <IconButton
        aria-label={t('common.language')}
        aria-haspopup="menu"
        onClick={(event) => setAnchor(event.currentTarget)}
        data-testid="guest-language"
        sx={{ minWidth: 44, minHeight: 44 }}
      >
        {currentFlag ? <FlagIcon code={currentFlag} width={24} /> : <TranslateIcon fontSize="small" />}
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {SUPPORTED_LANGUAGES.map((code) => {
          const flag = FLAG_FOR_LANGUAGE[code];
          return (
            <MenuItem
              key={code}
              selected={code === current}
              data-testid={`guest-language-${code}`}
              onClick={() => {
                void i18n.changeLanguage(code);
                setAnchor(null);
              }}
              sx={{ gap: 1.25 }}
            >
              {flag ? (
                <ListItemIcon sx={{ minWidth: 0 }}>
                  <FlagIcon code={flag} width={23} />
                </ListItemIcon>
              ) : null}
              <ListItemText primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }}>
                {LANGUAGE_LABELS[code as SupportedLanguage]}
              </ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
