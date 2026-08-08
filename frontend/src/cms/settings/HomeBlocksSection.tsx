import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { fetchHomeSettings, putHomeSettings } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';

/**
 * Настройки главной витрины: погода, координаты отеля, строка состояния номера.
 *
 * ПОГОДА БЕЗ КООРДИНАТ НЕ ВКЛЮЧАЕТСЯ — и переключатель это показывает, а не
 * прячет: оператор, который включил галочку и не увидел блока у гостя, пойдёт
 * писать в поддержку, и будет прав. Сервер держит то же правило, поэтому
 * обойти его формой нельзя.
 *
 * ИСТОЧНИК ДАННЫХ НАЗВАН ЗДЕСЬ, А НЕ У ГОСТЯ. Подпись на витрине снята
 * решением владельца продукта; оператор при этом обязан знать, чьи данные
 * показывает его отель, — хотя бы затем, чтобы ответить на вопрос гостя.
 * Лицензионная сторона: docs/ops/weather.md.
 */
export function HomeBlocksSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({ queryKey: queryKeys.homeSettings, queryFn: fetchHomeSettings });

  const [weather, setWeather] = useState(false);
  const [roomStatus, setRoomStatus] = useState(true);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  useEffect(() => {
    if (!query.data) return;
    setWeather(query.data.weather);
    setRoomStatus(query.data.room_status);
    setLatitude(query.data.latitude === null ? '' : String(query.data.latitude));
    setLongitude(query.data.longitude === null ? '' : String(query.data.longitude));
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      putHomeSettings({
        weather,
        room_status: roomStatus,
        latitude: latitude.trim() === '' ? null : Number(latitude),
        longitude: longitude.trim() === '' ? null : Number(longitude),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.homeSettings, data);
      toast.show(t('cms.homeBlocks.saved'), 'success');
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.message : t('cms.homeBlocks.saveFailed'), 'error'),
  });

  if (query.isPending) return <Skeleton variant="rounded" height={220} />;
  if (query.isError) return <Alert severity="error">{t('cms.homeBlocks.loadFailed')}</Alert>;

  const point = latitude.trim() !== '' && longitude.trim() !== '';
  const provider = query.data.weather_provider;

  return (
    <Card data-testid="cms-home-blocks">
      <CardContent>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="h6">{t('cms.homeBlocks.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('cms.homeBlocks.hint')}
            </Typography>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('cms.homeBlocks.latitude')}
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              inputProps={{ inputMode: 'decimal', 'data-testid': 'cms-home-latitude' }}
              fullWidth
              size="small"
            />
            <TextField
              label={t('cms.homeBlocks.longitude')}
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              inputProps={{ inputMode: 'decimal', 'data-testid': 'cms-home-longitude' }}
              fullWidth
              size="small"
            />
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={weather && point}
                disabled={!point}
                onChange={(event) => setWeather(event.target.checked)}
                data-testid="cms-home-weather"
              />
            }
            label={
              <Stack spacing={0.25}>
                <Typography variant="body2">{t('cms.homeBlocks.weather')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {point ? (
                    <>
                      {t('cms.homeBlocks.source')}{' '}
                      <Link href={provider.url} target="_blank" rel="noopener noreferrer">
                        {provider.name}
                      </Link>
                    </>
                  ) : (
                    t('cms.homeBlocks.weatherNeedsPoint')
                  )}
                </Typography>
              </Stack>
            }
          />

          <FormControlLabel
            control={
              <Switch
                checked={roomStatus}
                disabled={!query.data.room_status_available}
                onChange={(event) => setRoomStatus(event.target.checked)}
                data-testid="cms-home-room-status"
              />
            }
            label={
              <Stack spacing={0.25}>
                <Typography variant="body2">{t('cms.homeBlocks.roomStatus')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {query.data.room_status_available
                    ? t('cms.homeBlocks.roomStatusHint')
                    : t('cms.homeBlocks.roomStatusNeedsModule')}
                </Typography>
              </Stack>
            }
          />

          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              data-testid="cms-home-blocks-save"
            >
              {t('common.save')}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
