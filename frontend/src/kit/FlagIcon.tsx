import Box from '@mui/material/Box';

/**
 * Vector flag icon for the language switcher.
 *
 * The four flags are the exact vector artwork from the approved reference
 * screens, ported from the reference's inline `data:image/svg+xml` marks to real
 * inline SVG. NO emoji flags anywhere.
 *
 * National-flag colours are *content* (like a logo image), not UI chrome, so
 * they legitimately live as literals inside the artwork. The surrounding chrome
 * — the rounded clip and the hairline ring — is drawn from theme tokens, so the
 * "colours only from tokens" rule still holds for everything the app controls.
 */

export type FlagCode = 'gb' | 'ru' | 'sa' | 'cn';

/** Language → flag mapping used by the guest language switcher. */
export const FLAG_FOR_LANGUAGE: Record<string, FlagCode> = {
  en: 'gb',
  ru: 'ru',
  ar: 'sa',
  zh: 'cn',
};

const ARTWORK: Record<FlagCode, { viewBox: string; svg: React.ReactNode }> = {
  gb: {
    viewBox: '0 0 60 30',
    svg: (
      <>
        <clipPath id="flag-gb-clip">
          <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
        </clipPath>
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path
          d="M0,0 L60,30 M60,0 L0,30"
          clipPath="url(#flag-gb-clip)"
          stroke="#C8102E"
          strokeWidth="4"
        />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </>
    ),
  },
  ru: {
    viewBox: '0 0 9 6',
    svg: (
      <>
        <rect width="9" height="6" fill="#fff" />
        <rect y="2" width="9" height="4" fill="#0039A6" />
        <rect y="4" width="9" height="2" fill="#D52B1E" />
      </>
    ),
  },
  sa: {
    viewBox: '0 0 60 40',
    svg: (
      <>
        <rect width="60" height="40" fill="#165D31" />
        <rect x="11" y="13" width="38" height="3.4" rx="1.7" fill="#fff" />
        <rect x="11" y="19" width="30" height="2.6" rx="1.3" fill="#fff" />
        <rect x="11" y="26" width="38" height="2.4" rx="1.2" fill="#fff" />
        <path d="M11 30 l5 3.4 h28 l5-3.4" fill="none" stroke="#fff" strokeWidth="1.8" />
      </>
    ),
  },
  cn: {
    viewBox: '0 0 60 40',
    svg: (
      <>
        <rect width="60" height="40" fill="#DE2910" />
        <g fill="#FFDE00">
          <path d="M11 4.6 L13 10.8 L19.3 10.8 L14.2 14.6 L16.2 20.8 L11 17 L5.8 20.8 L7.8 14.6 L2.7 10.8 L9 10.8 Z" />
          <circle cx="22.5" cy="4" r="1.7" />
          <circle cx="27" cy="8" r="1.7" />
          <circle cx="27" cy="14" r="1.7" />
          <circle cx="22.5" cy="18" r="1.7" />
        </g>
      </>
    ),
  },
};

export interface FlagIconProps {
  code: FlagCode;
  /** Rendered width in px (height keeps the reference 23×16 ratio). */
  width?: number;
  testId?: string;
}

export function FlagIcon({ code, width = 23, testId }: FlagIconProps) {
  const art = ARTWORK[code];
  const height = Math.round((width * 16) / 23);
  return (
    <Box
      data-testid={testId ?? `flag-${code}`}
      aria-hidden
      sx={(theme) => ({
        width,
        height,
        flex: 'none',
        borderRadius: `${Math.round(theme.palette.brand.radius.sm * 0.6)}px`,
        overflow: 'hidden',
        display: 'block',
        // Hairline ring from a token — keeps a light flag legible on a light row.
        boxShadow: `inset 0 0 0 1px ${theme.palette.divider}`,
      })}
    >
      <Box
        component="svg"
        viewBox={art.viewBox}
        preserveAspectRatio="xMidYMid slice"
        sx={{ width: '100%', height: '100%', display: 'block' }}
      >
        {art.svg}
      </Box>
    </Box>
  );
}
