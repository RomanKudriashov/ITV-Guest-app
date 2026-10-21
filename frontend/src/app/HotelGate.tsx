import { useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { api } from '@/api/client';
import { AppThemeProvider } from '@/theme';
import type { PartialBrandTokens } from '@/theme/tokens';

/**
 * ОТЕЛЬ ЗАКРЫТ ИЛИ ПЕРЕЕХАЛ (партия 62-C) — до любого экрана на адресе отеля.
 *
 * Сервер отвечает на открытой ручке состояния:
 *   * `moved` — прежний поддомен: уходим на новый адрес С ТЕМ ЖЕ путём, и
 *     старый QR `/r/<номер>` открывает тот же номер уже по новому адресу;
 *   * `disabled` — гость видит заглушку в бренде отеля, без причины; панель
 *     и доска рисуются как есть, а вход отвечает «Вход недоступен».
 *
 * Посреди работы отель могут отключить: клиент API, получив 423 или 410,
 * шлёт событие `HOTEL_STATE_EVENT`, и заслонка спрашивает состояние заново.
 */

export const HOTEL_STATE_EVENT = 'itv:hotel-state';

interface HotelStatus {
  state: 'active' | 'disabled' | 'moved';
  name?: string;
  names?: Record<string, string>;
  theme?: PartialBrandTokens;
  location?: string;
}

const statusKey = ['hotel-status'] as const;

function useHotelStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    const again = () => void qc.invalidateQueries({ queryKey: statusKey });
    window.addEventListener(HOTEL_STATE_EVENT, again);
    return () => window.removeEventListener(HOTEL_STATE_EVENT, again);
  }, [qc]);
  return useQuery({
    queryKey: statusKey,
    queryFn: () => api.get<HotelStatus>('/hotel/status', { skipAuthRedirect: true }),
    staleTime: 60_000,
    retry: 1,
  });
}

export function HotelGate({ kind, children }: { kind: 'guest' | 'staff'; children: ReactNode }) {
  const status = useHotelStatus();
  const data = status.data;

  useEffect(() => {
    if (data?.state === 'moved' && data.location) {
      const { pathname, search, hash } = window.location;
      window.location.replace(`${data.location}${pathname}${search}${hash}`);
    }
  }, [data]);

  if (data?.state === 'moved') return null;
  if (data?.state === 'disabled' && kind === 'guest') return <HotelClosed status={data} />;
  // Пока состояние неизвестно, экраны не держим: отказ ручки состояния —
  // не повод запирать работающий отель.
  return <>{children}</>;
}

function HotelClosed({ status }: { status: HotelStatus }) {
  const { i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? i18n.language ?? '').split('-')[0];
  return (
    <AppThemeProvider brandTokens={status.theme}>
      <ClosedScreen name={status.names?.[lang] || status.name || ''} />
    </AppThemeProvider>
  );
}

function ClosedScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="guest-hotel-closed"
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        px: 3,
        bgcolor: 'background.default',
        backgroundImage: (theme) =>
          `radial-gradient(120% 80% at 50% 0%, ${theme.palette.primary.main}22, transparent 70%)`,
      }}
    >
      <Box sx={{ maxWidth: 420, textAlign: 'center' }}>
        <Typography component="h1" variant="h4" sx={{ fontWeight: 800, color: 'text.primary', mb: 2 }} data-testid="guest-hotel-closed-name">
          {name}
        </Typography>
        <Box sx={{ width: 48, height: 4, borderRadius: 2, bgcolor: 'primary.main', mx: 'auto', mb: 2.5 }} />
        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, mb: 1 }}>
          {t('guest.closed.title')}
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          {t('guest.closed.body')}
        </Typography>
      </Box>
    </Box>
  );
}
