import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/ToastProvider';
import { useBootstrap } from '@/hooks/useBootstrap';
import { useAppTheme } from '@/theme';
import { resolveDefaultMode, type ThemeMode } from '@/theme/tokens';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth';
import { BrandEditor } from './BrandEditor';
import { BrandPreview } from './BrandPreview';
import { useBrandDraft } from './useBrandDraft';

export function BrandPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { hotel } = useAuth();
  const { data: bootstrap } = useBootstrap();
  const { setBrandTokens } = useAppTheme();

  const brand = useBrandDraft();
  const { dirty, isLoading, loadError, isSaving, merged, draft } = brand;

  const [previewMode, setPreviewMode] = useState<ThemeMode>('light');
  const [rtl, setRtl] = useState(false);

  // Open the preview in the brand's own default mode once, when data first lands.
  const seededMode = useRef(false);
  useEffect(() => {
    if (seededMode.current || !brand.record) return;
    seededMode.current = true;
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setPreviewMode(resolveDefaultMode(merged, Boolean(prefersDark)));
  }, [brand.record, merged]);

  const hotelName = bootstrap?.hotel?.name ?? hotel?.name ?? t('app.title');
  const appLanguage = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  const onSave = async () => {
    try {
      await brand.save();
      // Optional: reflect the saved brand in the operator's own CMS session too.
      setBrandTokens(draft);
      toast.show(t('brand.saved'), 'success');
    } catch (error) {
      const message = error instanceof ApiError ? error.detail : t('brand.saveFailed');
      toast.show(message, 'error');
    }
  };

  if (isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress aria-label={t('brand.loading')} />
      </Stack>
    );
  }

  if (loadError) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="error">
          {loadError instanceof ApiError ? loadError.detail : t('brand.loadFailed')}
        </Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 2 }}
      >
        <Typography variant="h5" component="h1" sx={{ mr: 'auto' }}>
          {t('brand.title')}
        </Typography>
        {dirty ? (
          <Chip color="warning" size="small" label={t('brand.dirty')} data-testid="brand-dirty" />
        ) : null}
        <Button
          variant="outlined"
          onClick={brand.reset}
          disabled={!dirty || isSaving}
          data-testid="brand-reset"
        >
          {t('brand.reset')}
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={!dirty || isSaving}
          data-testid="brand-save"
        >
          {t('brand.save')}
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 440px)' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <BrandEditor brand={brand} mode={previewMode} />

        <Box sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
          <BrandPreview
            tokens={merged}
            hotelName={hotelName}
            abstractions={brand.abstractions}
            mode={previewMode}
            onModeChange={setPreviewMode}
            rtl={rtl}
            onRtlChange={setRtl}
            appLanguage={appLanguage}
          />
        </Box>
      </Box>
    </Box>
  );
}
