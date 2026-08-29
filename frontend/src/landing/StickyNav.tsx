import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { GuestLanguageMenu } from '@/guest/components/GuestLanguageMenu';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';

/**
 * Липкая полоса, которая появляется, когда обложка ушла вверх.
 *
 * ПОЧЕМУ НЕ ПОВЕРХ ФОТОГРАФИИ. Переключатели языка и темы стояли прямо на
 * кадре и терялись на нём: белая иконка попадает то на светлую штору, то на
 * тёмное дерево, и читается по-разному в каждой точке прокрутки. Полоса даёт
 * им собственный фон, а обложка остаётся чистой фотографией.
 *
 * МАТОВОЕ СТЕКЛО — `backdrop-filter: blur`. Размывается то, что проезжает ПОД
 * полосой, поэтому текст на ней читается над любым содержимым. Где
 * `backdrop-filter` не поддержан, остаётся просто полупрозрачный фон — темнее,
 * но читаемо; проверка идёт через `@supports`, а не через определение браузера.
 *
 * ПОЯВЛЕНИЕ ПО ВИДИМОСТИ ОБЛОЖКИ, А НЕ ПО ЧИСЛУ ПИКСЕЛЕЙ. `IntersectionObserver`
 * не стоит ни одного кадра на прокрутке, в отличие от обработчика `scroll`,
 * который считает на каждый тик. И порог здесь смысловой: «обложка ушла» — это
 * про обложку, а не про 300 пикселей, которые завтра станут другими.
 */
export function StickyNav({ heroId, calm }: { heroId: string; calm: boolean }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.querySelector(`[data-testid="${heroId}"]`);
    if (!hero) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setShown(!entry.isIntersecting),
      // Полоса появляется, когда от обложки осталась четверть: не в тот
      // момент, когда исчез последний её пиксель.
      { threshold: 0.25 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroId]);

  const links = ['devices', 'how', 'contact'] as const;

  return (
    <Box
      component="nav"
      data-testid="landing-nav"
      data-shown={shown ? 'true' : 'false'}
      sx={{
        position: 'fixed',
        top: 0,
        insetInline: 0,
        zIndex: 10,
        px: { xs: 2, md: 4 },
        py: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        borderBottom: '1px solid',
        borderColor: (theme) => alpha(theme.palette.divider, 0.6),
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.72),
        '@supports (backdrop-filter: blur(1px))': {
          backdropFilter: 'blur(14px) saturate(140%)',
          bgcolor: (theme) => alpha(theme.palette.background.default, 0.55),
        },
        // Плавно, а не рывком. При просьбе не двигать — мгновенно и без сдвига.
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(-100%)',
        pointerEvents: shown ? 'auto' : 'none',
        transition: calm ? 'none' : 'opacity .28s ease, transform .28s ease',
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: 'auto' }}>
        {t('landing.nav.brand')}
      </Typography>
      <Stack direction="row" spacing={2.5} sx={{ display: { xs: 'none', md: 'flex' } }}>
        {links.map((link) => (
          <Box
            key={link}
            component="a"
            href={`#${link}`}
            data-testid={`landing-nav-${link}`}
            sx={{ color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'text.primary' } }}
          >
            <Typography variant="body2">{t(`landing.nav.${link}`)}</Typography>
          </Box>
        ))}
      </Stack>
      <GuestLanguageMenu />
      <ThemeModeToggle />
    </Box>
  );
}
