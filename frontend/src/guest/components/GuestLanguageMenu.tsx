import { useEffect, useMemo, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TranslateIcon from '@mui/icons-material/Translate';
import { useTranslation } from 'react-i18next';

import { FLAG_FOR_LANGUAGE, FlagIcon } from '@/kit';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { useOptionalGuestSession } from '../session/GuestSessionProvider';

const IS_SUPPORTED = (code: string): code is SupportedLanguage =>
  (SUPPORTED_LANGUAGES as readonly string[]).includes(code);

/**
 * Compact language picker for the guest header (the CMS one is a select).
 * Each language carries its vector flag; the trigger shows
 * the active language's flag. No emoji flags.
 *
 * ЯЗЫКИ — ОТЕЛЯ, А НЕ СБОРКИ.
 *
 * Меню перебирало `SUPPORTED_LANGUAGES` — все четыре языка, на которые
 * переведён интерфейс. Отель, который ведёт контент на двух, всё равно
 * предлагал гостю четыре: выбрав третий, гость получал меню, названия блюд и
 * описания на чужом языке вперемешку с переводом интерфейса. Список отеля
 * приезжает в сессии (`hotel.languages`) — берём его.
 *
 * Посадочная страница платформы отеля не знает, и там список сборки — верный
 * ответ: выбирать не из чего, кроме языков самого интерфейса.
 */
export function GuestLanguageMenu() {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const guest = useOptionalGuestSession();
  const hotel = guest?.session?.hotel ?? guest?.hotel ?? null;

  const codes = useMemo<SupportedLanguage[]>(() => {
    // Язык, включённый отелем, но не переведённый в сборке, показать нечем:
    // интерфейс на нём не заговорит. Такой отсеиваем, а не рисуем заглушкой.
    const enabled = (hotel?.languages ?? [])
      .map((language) => language.code)
      .filter(IS_SUPPORTED);
    return enabled.length ? enabled : [...SUPPORTED_LANGUAGES];
  }, [hotel]);

  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  /*
    ВЫБРАННЫЙ ЯЗЫК ОТКЛЮЧИЛИ — уходим на основной язык отеля.

    Иначе гость, выбравший язык вчера, сегодня остаётся на языке, которого у
    отеля больше нет: интерфейс переведён, контент — нет, и экран выглядит
    наполовину пустым без всякого объяснения.
  */
  useEffect(() => {
    if (codes.includes(current as SupportedLanguage)) return;
    const fallback = hotel?.default_language;
    const target =
      fallback && codes.includes(fallback as SupportedLanguage)
        ? (fallback as SupportedLanguage)
        : codes[0];
    if (target && target !== current) void i18n.changeLanguage(target);
  }, [codes, current, hotel, i18n]);

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
        {codes.map((code) => {
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
                {LANGUAGE_LABELS[code]}
              </ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
