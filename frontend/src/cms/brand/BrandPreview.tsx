/**
 * ПОКАЗ ВИТРИНЫ В НАСТРОЙКЕ ОФОРМЛЕНИЯ.
 *
 * Раньше здесь стояла СОБРАННАЯ РУКАМИ верхняя треть главной: четыре
 * компонента витрины, три выдуманных блюда и шапка, которой у гостя нет. Любая
 * новая полоса на настоящей главной в показ не попадала, а из одиннадцати
 * экранов гость видел один.
 *
 * Теперь показ рисует НАСТОЯЩИЕ экраны: берёт их таблицу маршрутов у витрины
 * (`guestBranch`), открывает нужный адрес и подкладывает данные, посчитанные
 * теми же сборщиками, что отвечают гостю. Добавили экран витрине — он
 * появился и здесь; забыть про него нельзя.
 *
 * Ширины настоящие: экран живёт в рамке со своим окном, и оболочка
 * переключается по-честному — см. `PreviewStage`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { useTranslation } from 'react-i18next';

import type { BrandTokens, ThemeMode } from '@/theme';
import type { BrandAbstraction } from '@/api/brand';
import { PreviewStage } from './PreviewStage';
import { PREVIEW_SCREENS, resolveRoute, type PreviewScreenId } from './previewScreens';
import { usePreviewData } from './usePreviewData';

/**
 * НАСТОЯЩИЕ РАЗМЕРЫ УСТРОЙСТВ, а не круглые числа.
 *
 * Планшет — 820 на 1180 (портретный iPad): он НИЖЕ порога 1024 и показывает
 * телефонную оболочку. Это не ошибка списка, а правда о витрине, которую
 * оператор обязан увидеть: на портретном планшете гость видит именно её.
 * Компьютер — 1280, телевизор — 1920: оба выше порога, оболочка десктопная.
 */
const DEVICES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 800 },
  tv: { width: 1920, height: 1080 },
} as const;

type DeviceId = keyof typeof DEVICES;

export interface BrandPreviewProps {
  tokens: BrandTokens;
  hotelName: string;
  abstractions: BrandAbstraction[];
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
  rtl: boolean;
  onRtlChange: (rtl: boolean) => void;
  appLanguage: string;
  /** Валюта отеля — её показывает корзина и карточка позиции. */
  currency?: string;
  minorUnits?: number;
}

export function BrandPreview({
  tokens,
  hotelName,
  mode,
  onModeChange,
  rtl,
  onRtlChange,
  appLanguage,
  currency = 'RUB',
  minorUnits = 100,
}: BrandPreviewProps) {
  const { t } = useTranslation();
  const [device, setDevice] = useState<DeviceId>('phone');
  const [screenId, setScreenId] = useState<PreviewScreenId>('home');
  const [full, setFull] = useState(false);

  const screen = useMemo(
    () => PREVIEW_SCREENS.find((row) => row.id === screenId) ?? PREVIEW_SCREENS[0],
    [screenId],
  );
  const language = rtl ? 'ar' : appLanguage;
  const { client, isLoading, error, venue } = usePreviewData(screen, language);

  // Адрес собирается ПОСЛЕ ответа: код заведения называет сервер. `null` —
  // гостевых заведений у отеля нет, и показывать этот экран нечем.
  const route = resolveRoute(screen, venue);

  // Во сколько ужать рамку, чтобы она влезла в колонку. Меряем колонку, а не
  // гадаем: ширина панели зависит от окна оператора и от того, свёрнуто ли меню.
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(440);
  useEffect(() => {
    const node = holderRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const frame = DEVICES[device];
  const scale = Math.min(1, available / frame.width);

  const stage = (fit: number) => (
    <PreviewStage
      tokens={tokens}
      mode={mode}
      rtl={rtl}
      language={language}
      route={route ?? '/'}
      width={frame.width}
      height={frame.height}
      scale={fit}
      client={client}
      hotelName={hotelName}
      currency={currency}
      minorUnits={minorUnits}
    />
  );

  return (
    <Box data-testid="brand-preview" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
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
          RTL
        </ToggleButton>
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        {/* ЭКРАН — ПЕРВЫЙ ОРГАН УПРАВЛЕНИЯ: показ теперь про весь путь гостя,
            а не про верхнюю треть одного экрана. */}
        <TextField
          select
          size="small"
          label={t('brand.preview.screen.label')}
          value={screenId}
          onChange={(event) => setScreenId(event.target.value as PreviewScreenId)}
          sx={{ minWidth: 200 }}
          SelectProps={{
            SelectDisplayProps: { 'data-testid': 'brand-preview-screen' } as never,
          }}
        >
          {PREVIEW_SCREENS.map((row) => (
            <MenuItem key={row.id} value={row.id} data-testid={`brand-preview-screen-${row.id}`}>
              {t(row.labelKey)}
            </MenuItem>
          ))}
        </TextField>

        <ToggleButtonGroup
          size="small"
          exclusive
          value={device}
          onChange={(_e, next: DeviceId | null) => next && setDevice(next)}
          aria-label={t('brand.preview.device')}
        >
          {(Object.keys(DEVICES) as DeviceId[]).map((id) => (
            <ToggleButton key={id} value={id} data-testid={`brand-preview-device-${id}`}>
              {t(`brand.preview.${id}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* РАЗВЕРНУТЬ — чтобы десктоп можно было разглядеть, а не только
            убедиться, что оболочка переключилась. */}
        <Button
          size="small"
          startIcon={<OpenInFullIcon fontSize="small" />}
          onClick={() => setFull(true)}
          data-testid="brand-preview-full"
        >
          {t('brand.preview.expand')}
        </Button>
      </Stack>

      {error ? (
        <Alert severity="warning" data-testid="brand-preview-error">
          {t('brand.preview.dataFailed')}
        </Alert>
      ) : null}

      <Box ref={holderRef} sx={{ width: '100%' }}>
        {isLoading ? (
          <Stack alignItems="center" sx={{ py: 6 }} data-testid="brand-preview-loading">
            <CircularProgress size={28} />
          </Stack>
        ) : route === null ? (
          <Alert severity="info" data-testid="brand-preview-no-venue">
            {t('brand.preview.noVenue')}
          </Alert>
        ) : (
          stage(scale)
        )}
      </Box>

      <Dialog open={full} onClose={() => setFull(false)} fullScreen data-testid="brand-preview-dialog">
        <Stack direction="row" spacing={1} sx={{ p: 1.5 }} alignItems="center">
          <Typography variant="subtitle2" sx={{ mr: 'auto' }}>
            {t(screen.labelKey)} · {frame.width}×{frame.height}
          </Typography>
          <Button size="small" onClick={() => setFull(false)} data-testid="brand-preview-full-close">
            {t('common.close')}
          </Button>
        </Stack>
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2, overflow: 'auto' }}>
          {stage(Math.min(1, (typeof window !== 'undefined' ? window.innerWidth - 64 : frame.width) / frame.width))}
        </Box>
      </Dialog>
    </Box>
  );
}
