import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';

import { GuestLanguageMenu } from '@/guest/components/GuestLanguageMenu';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';

/**
 * Язык и тема — ОДИН элемент, который переезжает с обложки в появившееся меню.
 *
 * ПОЧЕМУ НЕ ДВА КОМПЛЕКТА. Поставить одни переключатели на обложку, а вторые в
 * полосу — значит завести два состояния одного и того же и надеяться, что они
 * совпадут; переезда при этом не будет вовсе, будет подмена. Здесь элемент
 * ровно один, закреплён у верхнего края и меняет только своё оформление и
 * отступ: полоса появляется — стекло под значками растворяется, и они
 * оказываются в её строке.
 *
 * ЧИТАЕМОСТЬ НА ФОТОГРАФИИ — ОТДЕЛЬНАЯ ЗАБОТА, А НЕ СЛЕДСТВИЕ ТЕМЫ. Значок темы
 * рисуется цветом `action.active`, то есть тёмным на светлой теме, и на тёмном
 * кадре обложки он пропадал целиком. Пока обложка видна, цвет значков задан
 * белым принудительно, а под ними лежит тёмное стекло: кадр под ними может быть
 * любым, и полагаться на его светлоту нельзя. Как только полоса появилась,
 * значки возвращаются к цвету темы — там под ними уже свой фон.
 */
export function LandingControls({ heroGone, calm }: { heroGone: boolean; calm: boolean }) {
  return (
    <Box
      data-testid="landing-controls"
      data-place={heroGone ? 'nav' : 'hero'}
      sx={{
        position: 'fixed',
        // Полоса стоит на `py: 1`, то есть её строка начинается на 8 пикселях.
        // На обложке значки опущены ниже — оттуда и виден переезд.
        top: heroGone ? 8 : 22,
        right: { xs: heroGone ? 16 : 20, md: heroGone ? 32 : 40 },
        // Выше полосы: во время переезда значки идут ПОВЕРХ неё, а не под ней.
        zIndex: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        borderRadius: 999,
        px: heroGone ? 0 : 0.5,
        bgcolor: (theme) => (heroGone ? 'transparent' : alpha(theme.palette.common.black, 0.42)),
        '@supports (backdrop-filter: blur(1px))': {
          backdropFilter: heroGone ? 'none' : 'blur(10px)',
        },
        '& .MuiIconButton-root': {
          color: (theme) => (heroGone ? theme.palette.text.primary : theme.palette.common.white),
        },
        transition: calm
          ? 'none'
          : 'top .32s ease, right .32s ease, background-color .32s ease, padding .32s ease',
      }}
    >
      <GuestLanguageMenu />
      <ThemeModeToggle />
    </Box>
  );
}
