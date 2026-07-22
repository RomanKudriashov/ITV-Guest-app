import { useEffect, useMemo, useState } from 'react';
import { CacheProvider, type EmotionCache } from '@emotion/react';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { createAppTheme, resolveBackground, type BrandTokens, type ThemeMode } from '@/theme';
import { formatMoney } from '@/utils/money';
import { GuestBrandHeader } from '@/guest/components/GuestBrandHeader';
import { CatalogRowView } from '@/guest/components/CatalogRow';
import { ItemHeadlineView } from '@/guest/components/ItemHeadline';
import type { BrandAbstraction } from '@/api/brand';
import { previewI18n } from './previewI18n';
import { PREVIEW_DETAIL, PREVIEW_ROWS } from './previewData';

// Preview-only emotion caches. Distinct keys keep preview class names from
// colliding with the CMS (`mui` / `mui-rtl`); the RTL cache runs stylis-plugin-rtl
// so the preview mirrors independently of the LTR CMS around it.
const previewLtrCache: EmotionCache = createCache({
  key: 'brand-preview',
  stylisPlugins: [prefixer],
});
const previewRtlCache: EmotionCache = createCache({
  key: 'brand-preview-rtl',
  stylisPlugins: [prefixer, rtlPlugin],
});

/**
 * Preview-frame form factors. Each resizes ONLY the isolated preview frame
 * (max width + aspect ratio), never the surrounding CMS. `tv` is a deliberately
 * marked placeholder for a future large-screen target — not selectable yet.
 */
type PreviewDevice = 'phone' | 'tablet' | 'desktop';

const DEVICE_FRAME: Record<PreviewDevice, { maxWidth: number; aspectRatio: string }> = {
  phone: { maxWidth: 400, aspectRatio: '10 / 19' },
  tablet: { maxWidth: 620, aspectRatio: '3 / 4' },
  desktop: { maxWidth: 900, aspectRatio: '16 / 10' },
};

export interface BrandPreviewProps {
  /** Fully merged draft tokens — the preview repaints on every change. */
  tokens: BrandTokens;
  hotelName: string;
  abstractions: BrandAbstraction[];
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
  rtl: boolean;
  onRtlChange: (rtl: boolean) => void;
  /** Language of the CMS session, mirrored by the preview when not in RTL mode. */
  appLanguage: string;
}

export function BrandPreview({
  tokens,
  hotelName,
  abstractions,
  mode,
  onModeChange,
  rtl,
  onRtlChange,
  appLanguage,
}: BrandPreviewProps) {
  const { t } = useTranslation();
  // Device is preview-only local state; it never touches the CMS around it.
  const [device, setDevice] = useState<PreviewDevice>('phone');
  const frame = DEVICE_FRAME[device];
  const direction = rtl ? 'rtl' : 'ltr';
  const language = rtl ? 'ar' : appLanguage;

  // Drive the isolated preview instance; never touches the CMS i18n.
  useEffect(() => {
    void previewI18n.changeLanguage(language);
  }, [language]);

  const theme = useMemo(
    () => createAppTheme(tokens, mode, direction),
    [tokens, mode, direction],
  );

  const abstractionUrl = useMemo(() => {
    const byCode = new Map(abstractions.map((a) => [a.code, a.preview_url]));
    return (code: string) => byCode.get(code);
  }, [abstractions]);

  const background = useMemo(
    () => resolveBackground(tokens, mode, { abstractionUrl }),
    [tokens, mode, abstractionUrl],
  );

  const cache = rtl ? previewRtlCache : previewLtrCache;

  const priceOf = (minor: number | null) =>
    minor === null ? null : formatMoney(minor, 'RUB', 2, language, { trimZeroFraction: true });

  return (
    <Box data-testid="brand-preview" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Preview controls live in the CMS theme so they always read normally. */}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" sx={{ mr: 'auto' }}>
          {t('brand.preview.title')}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_e, next: ThemeMode | null) => next && onModeChange(next)}
          aria-label={t('brand.preview.mode')}
          data-testid="brand-preview-mode-toggle"
        >
          <ToggleButton value="light">{t('brand.preview.light')}</ToggleButton>
          <ToggleButton value="dark">{t('brand.preview.dark')}</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButton
          size="small"
          value="rtl"
          selected={rtl}
          onChange={() => onRtlChange(!rtl)}
          aria-label={t('brand.preview.rtl')}
          data-testid="brand-preview-rtl-toggle"
        >
          {t('brand.preview.rtl')}
        </ToggleButton>
      </Stack>

      {/* Device switch — resizes ONLY the preview frame below. */}
      <ToggleButtonGroup
        size="small"
        exclusive
        value={device}
        onChange={(_e, next: PreviewDevice | null) => next && setDevice(next)}
        aria-label={t('brand.preview.device', { defaultValue: 'Device' })}
      >
        <ToggleButton value="phone" data-testid="brand-preview-device-phone">
          {t('brand.preview.phone', { defaultValue: 'Phone' })}
        </ToggleButton>
        <ToggleButton value="tablet" data-testid="brand-preview-device-tablet">
          {t('brand.preview.tablet', { defaultValue: 'Tablet' })}
        </ToggleButton>
        <ToggleButton value="desktop" data-testid="brand-preview-device-desktop">
          {t('brand.preview.desktop', { defaultValue: 'Desktop' })}
        </ToggleButton>
        {/* TV target is planned — placeholder slot, intentionally disabled. */}
        <ToggleButton value="tv" disabled data-testid="brand-preview-device-tv">
          {t('brand.preview.tv', { defaultValue: 'TV — soon' })}
        </ToggleButton>
      </ToggleButtonGroup>

      {/* The isolated subtree: own emotion cache, own theme, own direction/lang. */}
      <CacheProvider value={cache}>
        <I18nextProvider i18n={previewI18n}>
          <MuiThemeProvider theme={theme}>
            <Box
              dir={direction}
              data-testid="brand-preview-frame"
              sx={{
                position: 'relative',
                width: '100%',
                maxWidth: frame.maxWidth,
                aspectRatio: frame.aspectRatio,
                mx: 'auto',
                borderRadius: 4,
                overflow: 'hidden',
                border: 1,
                borderColor: 'divider',
                boxShadow: 3,
              }}
            >
              {/* Backdrop + optional dim layer, both built from brand tokens. */}
              <Box sx={{ position: 'absolute', inset: 0, ...background.css }} />
              {background.dim > 0 ? (
                <Box
                  sx={{ position: 'absolute', inset: 0, bgcolor: 'brand.scrim', opacity: background.dim }}
                />
              ) : null}

              <Box sx={{ position: 'relative', height: '100%', overflowY: 'auto' }}>
                <GuestBrandHeader
                  position="sticky"
                  hotelName={hotelName}
                  logoSrc={mode === 'dark' ? tokens.brand?.logoDark ?? tokens.brand?.logoLight : tokens.brand?.logoLight ?? tokens.brand?.logoDark}
                  rightSlot={
                    <Chip size="small" label={t('brand.preview.roomChip')} />
                  }
                />

                <Stack spacing={2} sx={{ p: 2 }}>
                  {/* 1. Menu list on a brand surface (surfaceStyle + radius visible). */}
                  <Paper elevation={1} sx={{ p: 2, borderRadius: 3 }}>
                    <Typography variant="h6" component="h2" gutterBottom>
                      {t('brand.preview.menuHeading')}
                    </Typography>
                    <Stack divider={<Box sx={{ height: 1, bgcolor: 'divider' }} />}>
                      {PREVIEW_ROWS.map((row) => (
                        <CatalogRowView
                          key={row.id}
                          testId={`brand-preview-row-${row.code}`}
                          title={row.title}
                          description={row.description}
                          imageSrc={row.images[0]}
                          flags={row.flags}
                          priceLabel={priceOf(row.price)}
                          available
                          action={
                            <Button variant="outlined" size="small" sx={{ minHeight: 44, minWidth: 44 }}>
                              +
                            </Button>
                          }
                        />
                      ))}
                    </Stack>
                  </Paper>

                  {/* 2. Item card body — the sheet content on a brand surface. */}
                  <Paper elevation={1} sx={{ p: 2, borderRadius: 3 }}>
                    <ItemHeadlineView item={PREVIEW_DETAIL} priceLabel={priceOf(PREVIEW_DETAIL.price)} />
                    <Divider sx={{ my: 2 }} />
                    <Button fullWidth variant="contained" size="large">
                      {t('brand.preview.addToCart')}
                    </Button>
                  </Paper>
                </Stack>
              </Box>
            </Box>
          </MuiThemeProvider>
        </I18nextProvider>
      </CacheProvider>
    </Box>
  );
}
