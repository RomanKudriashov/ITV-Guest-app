import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';

import { revealSx } from '@/kit/motion';

/**
 * ОБЩИЙ ЯЗЫК ЭКРАНА ВХОДА — один на CMS отеля и на консоль платформы.
 *
 * Раньше их было два и они не совпадали ни в чём. Вход в CMS — полотно во всю
 * ширину по эталону `docs/design/login-ac.html`: кадр с медленным приближением,
 * приветствие дисплейным Onest, поля-линии, круглая кнопка-стрелка. Вход в
 * консоль — светлая карточка 380px по центру серого поля, с полями MUI по
 * умолчанию и заливной кнопкой. Один продукт открывался двумя разными дверями.
 *
 * Куски вынесены СЮДА, а не скопированы: две копии одного экрана разъезжаются
 * на первой же правке — ровно так и появилось расхождение, которое чинится.
 */

/* ── векторные глифы (линейные, currentColor — без эмодзи и растра) ────────── */

export function Glyph({ children }: { children: ReactNode }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      sx={{ width: 18, height: 18, display: 'block' }}
    >
      {children}
    </Box>
  );
}

export const ArrowGlyph = (
  <Glyph>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </Glyph>
);

export const GlobeGlyph = (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3z" />
  </Glyph>
);

export const MoonGlyph = (
  <Glyph>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Glyph>
);

export const SunGlyph = (
  <Glyph>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Glyph>
);

/* ── стеклянная пилюля (эталон `.gh`) с зоной нажатия ≥44px ───────────────── */

export function GlassPill({
  onClick,
  children,
  ...rest
}: {
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  children: ReactNode;
  'data-testid'?: string;
  'aria-label'?: string;
  'aria-haspopup'?: boolean;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      {...rest}
      sx={(theme: Theme) => ({
        // Зона нажатия ≥44px; видимая пилюля остаётся 34px (эталон).
        minHeight: 44,
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.common.white}`,
          outlineOffset: 2,
        },
      })}
    >
      <Box
        sx={(theme: Theme) => ({
          height: 34,
          px: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          borderRadius: `${theme.palette.brand.radius.pill}px`,
          border: `1px solid ${alpha(theme.palette.common.white, 0.22)}`,
          backgroundColor: alpha(theme.palette.common.black, 0.28),
          color: theme.palette.common.white,
          fontSize: 12,
          fontWeight: theme.typography.fontWeightBold,
          transition: 'background-color .2s',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        {children}
      </Box>
    </ButtonBase>
  );
}

/* ── поле-линия (эталон `.lineinp`) ───────────────────────────────────────── */

export function lineRowSx(theme: Theme) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    px: '2px',
    py: '13px',
    borderBottom: `1px solid ${alpha(theme.palette.common.white, 0.28)}`,
    transition: 'border-color .25s',
    '&:hover': { borderColor: alpha(theme.palette.common.white, 0.6) },
    '&:focus-within': { borderColor: alpha(theme.palette.common.white, 0.6) },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  } as const;
}

// ВАЖНО (причина прошлого белого экрана): стандартный `::placeholder` в sx роняет
// stylis-prefixer — разворачивая вендор-префиксы псевдоэлемента, он обращается к
// коллекции детей узла, которой там нет → `.push` of undefined, весь экран падает.
// Поэтому `::placeholder` в рантайм-sx НЕ пишем, а задаём плейсхолдер уже-
// префиксными селекторами (`::-webkit-input-placeholder`, `::-moz-placeholder`) —
// их prefixer не трогает.
export const inputSx = (theme: Theme) => {
  const placeholder = { color: alpha(theme.palette.common.white, 0.42), opacity: 1 };
  return {
    flex: 1,
    color: theme.palette.common.white,
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: { xs: 17, md: 19 },
    '& input': {
      padding: 0,
      color: theme.palette.common.white,
    },
    '& input::-webkit-input-placeholder': placeholder,
    '& input::-moz-placeholder': placeholder,
    // Автозаполнение — вот откуда брались «белые прямоугольники» на входе в
    // CMS: WebKit кладёт СВОЙ фон поверх любого background и по спецификации
    // не даёт его перекрасить. Обходится единственным способом — тенью в
    // 1000px внутрь, которая закрашивает поле изнутри; заодно возвращаем цвет
    // текста, который автозаполнение тоже переопределяет.
    '& input:-webkit-autofill': {
      WebkitBoxShadow: `0 0 0 1000px ${alpha(theme.palette.common.black, 0.28)} inset`,
      WebkitTextFillColor: theme.palette.common.white,
      caretColor: theme.palette.common.white,
      borderRadius: 0,
      transition: 'background-color 9999s ease-in-out 0s',
    },
    '& input:-webkit-autofill:focus': {
      WebkitBoxShadow: `0 0 0 1000px ${alpha(theme.palette.common.black, 0.28)} inset`,
    },
  };
};

/** Круглая кнопка-стрелка в конце последнего поля. */
export function AuthSubmitButton({
  disabled,
  busy,
  rtl,
  label,
  testId,
}: {
  disabled: boolean;
  busy: boolean;
  rtl: boolean;
  label: string;
  testId: string;
}) {
  return (
    <ButtonBase
      type="submit"
      disabled={disabled}
      data-testid={testId}
      aria-label={label}
      sx={(theme: Theme) => ({
        flex: 'none',
        width: { xs: 42, md: 46 },
        height: { xs: 42, md: 46 },
        borderRadius: '50%',
        color: theme.palette.common.white,
        border: `1px solid ${alpha(theme.palette.common.white, 0.35)}`,
        backgroundColor: alpha(theme.palette.common.white, 0.06),
        transition: 'background-color .22s, transform .18s, color .22s',
        '&:hover': {
          backgroundColor: theme.palette.common.white,
          color: theme.palette.common.black,
          transform: rtl ? 'translateX(-3px)' : 'translateX(3px)',
        },
        '&.Mui-disabled': { opacity: 0.5 },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.common.white}`,
          outlineOffset: 2,
        },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      })}
    >
      {busy ? <CircularProgress size={18} color="inherit" /> : ArrowGlyph}
    </ButtonBase>
  );
}

/** Сообщение об отказе под формой. */
export function AuthError({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <Box
      role="alert"
      data-testid={testId}
      sx={(theme: Theme) => ({
        mt: '16px',
        px: '12px',
        py: '8px',
        borderRadius: `${theme.palette.brand.radius.sm}px`,
        border: `1px solid ${alpha(theme.palette.error.main, 0.5)}`,
        backgroundColor: alpha(theme.palette.error.main, 0.16),
        color: theme.palette.common.white,
        fontSize: 13,
      })}
    >
      {children}
    </Box>
  );
}

/** Подпись-намёк под формой: тире и текст. */
export function AuthHint({ children, index = 5 }: { children: ReactNode; index?: number }) {
  return (
    <Box
      sx={(theme: Theme) => ({
        mt: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        color: alpha(theme.palette.common.white, 0.4),
        fontSize: 12.5,
        ...revealSx({ index }),
      })}
    >
      <Box
        aria-hidden
        sx={(theme: Theme) => ({
          width: 26,
          height: 1,
          flex: 'none',
          backgroundColor: alpha(theme.palette.common.white, 0.28),
        })}
      />
      {children}
    </Box>
  );
}

/** Марка в верхнем углу: знак и название. */
export function AuthBrand({
  logoSrc,
  name,
  caption,
  logoTestId,
}: {
  logoSrc?: string;
  name: string;
  caption?: string;
  logoTestId?: string;
}) {
  return (
    <Box
      sx={(theme: Theme) => ({
        position: 'absolute',
        insetInlineStart: { xs: 24, md: 56 },
        insetBlockStart: { xs: 26, md: 34 },
        zIndex: 7,
        color: theme.palette.common.white,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        ...revealSx({ index: 0 }),
      })}
    >
      {logoSrc ? (
        <Box
          component="img"
          src={logoSrc}
          alt={name}
          data-testid={logoTestId}
          sx={{ height: { xs: 26, md: 32 }, width: 'auto', display: 'block' }}
        />
      ) : (
        <>
          <Box
            component="svg"
            viewBox="0 0 40 40"
            aria-hidden
            sx={{ width: { xs: 26, md: 32 }, height: { xs: 26, md: 32 }, opacity: 0.92 }}
          >
            <path
              d="M20 3.5 L34.5 16 L20 36.5 L5.5 16 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M5.5 16 H34.5 M20 3.5 V36.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.7"
              opacity="0.5"
            />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="span"
              sx={(theme: Theme) => ({
                display: 'block',
                fontFamily: theme.typography.h1.fontFamily,
                fontSize: { xs: 15, md: 17 },
                fontWeight: theme.typography.fontWeightMedium,
                lineHeight: 1.1,
              })}
            >
              {name}
            </Typography>
            {caption ? (
              <Typography
                component="span"
                sx={(theme: Theme) => ({
                  display: 'block',
                  mt: '3px',
                  fontSize: 10,
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: alpha(theme.palette.common.white, 0.55),
                })}
              >
                {caption}
              </Typography>
            ) : null}
          </Box>
        </>
      )}
    </Box>
  );
}

/** Ряд управляющих пилюль в верхнем углу напротив марки. */
export function AuthTopControls({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        insetBlockStart: { xs: 24, md: 22 },
        insetInlineEnd: { xs: 20, md: 24 },
        zIndex: 8,
        display: 'flex',
        gap: '8px',
        ...revealSx({ index: 0 }),
      }}
    >
      {children}
    </Box>
  );
}

/** Нижний левый блок: заголовок, подпись, форма. */
export function AuthPanel({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        insetInlineStart: { xs: 24, md: 56 },
        insetInlineEnd: { xs: 24, md: 'auto' },
        insetBlockEnd: { xs: 44, md: 62 },
        zIndex: 6,
        width: { xs: 'auto', md: 'min(470px, 60%)' },
      }}
    >
      {children}
    </Box>
  );
}

/** Крупный дисплейный заголовок экрана входа. */
export function AuthTitle({ children, tight }: { children: ReactNode; tight?: boolean }) {
  return (
    <Typography
      component="h1"
      sx={(theme: Theme) => ({
        fontFamily: theme.typography.h1.fontFamily,
        fontWeight: theme.typography.fontWeightBold,
        color: theme.palette.common.white,
        fontSize: { xs: 38, md: 58 },
        lineHeight: 0.98,
        letterSpacing: '-0.035em',
        maxWidth: { xs: tight ? '7ch' : 'none', md: 'none' },
        ...revealSx({ index: 1 }),
      })}
    >
      {children}
    </Typography>
  );
}

/** Подпись под заголовком. */
export function AuthSubtitle({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={(theme: Theme) => ({
        color: alpha(theme.palette.common.white, 0.6),
        fontSize: 14.5,
        mt: '13px',
        maxWidth: 400,
        ...revealSx({ index: 2 }),
      })}
    >
      {children}
    </Typography>
  );
}
