import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';

import { ApiError } from '@/api/client';
import { fetchHomeSettings, putHomeSettings } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';

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

  const { data: bootstrap } = useBootstrap();
  const contentLanguages = useContentLanguages(bootstrap);
  const query = useQuery({ queryKey: queryKeys.homeSettings, queryFn: fetchHomeSettings });

  const [weather, setWeather] = useState(false);
  const [roomStatus, setRoomStatus] = useState(true);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  // Город — подпись к погоде и часам у гостя, поэтому переводами, как весь
  // гостевой текст: «Москва» в арабском интерфейсе читается не лучше, чем
  // «Mainly clear».
  const [name, setName] = useState<Record<string, string>>({});
  const [city, setCity] = useState<Record<string, string>>({});
  /*
    Часовой пояс отеля. Наследовать его от сервера нельзя: сервер стоит там, где
    стоит, а отель — где угодно. От этого поля считаются и часы на главной, и
    «открыто до 23:00» — источник у них один.
  */
  const [timezone, setTimezone] = useState('');

  useEffect(() => {
    if (!query.data) return;
    setWeather(query.data.weather);
    setRoomStatus(query.data.room_status);
    setLatitude(query.data.latitude === null ? '' : String(query.data.latitude));
    setLongitude(query.data.longitude === null ? '' : String(query.data.longitude));
    setName(query.data.name ?? {});
    setCity(query.data.city ?? {});
    setTimezone(query.data.timezone ?? '');
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      putHomeSettings({
        weather,
        room_status: roomStatus,
        latitude: latitude.trim() === '' ? null : Number(latitude),
        longitude: longitude.trim() === '' ? null : Number(longitude),
        name,
        city,
        timezone,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.homeSettings, data);
      toast.show(t('cms.homeBlocks.saved'), 'success');
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.message : t('cms.homeBlocks.saveFailed'), 'error'),
  });

  if (query.isPending) return <Skeleton variant="rounded" height={220} />;
  if (query.isError)
    return (
      <QueryState query={query} what={t('state.what.homeBlocks')}>
        {() => null}
      </QueryState>
    );

  const point = latitude.trim() !== '' && longitude.trim() !== '';
  const languages = contentLanguages;
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

          {/*
            Часовой пояс — ИМЕНЕМ зоны, а не смещением: смещение врёт дважды в
            год на переходе и не умеет получаса (Индия, Иран).
          */}
          <Autocomplete
            options={query.data?.timezone_options ?? []}
            value={timezone || null}
            onChange={(_event, next) => setTimezone(next ?? '')}
            disableClearable={false}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label={t('cms.homeBlocks.timezone')}
                helperText={t('cms.homeBlocks.timezoneHint')}
                inputProps={{ ...params.inputProps, 'data-testid': 'cms-home-timezone' }}
              />
            )}
          />

          {/*
            Название отеля. Стоит первым: это единственная строка, которую
            гость видит на КАЖДОМ экране, и незаполненный язык здесь заметнее
            любого другого.
          */}
          <Stack spacing={1}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('cms.homeBlocks.hotelName')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              {languages.codes.map((code) => (
                <TextField
                  key={code}
                  size="small"
                  label={code.toUpperCase()}
                  value={name[code] ?? ''}
                  onChange={(event) => setName({ ...name, [code]: event.target.value })}
                  inputProps={{ 'data-testid': `cms-home-name-${code}` }}
                  fullWidth
                />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t('cms.homeBlocks.hotelNameHint')}
            </Typography>
          </Stack>

          {/* Город — подпись к погоде и часам. Пусто — подписи у гостя нет. */}
          <Stack spacing={1}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('cms.homeBlocks.city')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              {languages.codes.map((code) => (
                <TextField
                  key={code}
                  size="small"
                  label={code.toUpperCase()}
                  value={city[code] ?? ''}
                  onChange={(event) => setCity({ ...city, [code]: event.target.value })}
                  inputProps={{ 'data-testid': `cms-home-city-${code}` }}
                  fullWidth
                />
              ))}
            </Stack>
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
