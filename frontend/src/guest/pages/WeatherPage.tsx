import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { IconBack, IconMoon } from '@/icons';
import { fontPx } from '@/theme/fontPx';
import type { WeatherCity, WeatherDay, WeatherDetail, WeatherHour, WeatherMonth, WeatherOutlookDay, WeatherPlace } from '../api/types';
import { conditionOf } from '../components/HomeWeather';
import { useGuestWeather, useWeatherCities } from '../hooks/useGuestQueries';
import { cardSurfaceCss, surfaceRadius } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';

/**
 * ПОДРОБНАЯ ПОГОДА (партия 65) — всё, что Open-Meteo умеет для точки отеля.
 *
 * ГЛУБИНА — ЧЕСТНАЯ, И ОНА РАЗНАЯ. Обычный прогноз у провайдера — 16 дней, и это
 * предел: дальше идёт сезонный ансамбль, где каждый день — среднее по 51 прогону
 * с разбросом, а не точное число. Поэтому вкладки «46 дней» и «6 месяцев»
 * подписаны как ориентир, а дни после 16-го показывают диапазон.
 *
 * ДАННЫЕ ТОЛЬКО С СЕРВЕРА, как и строка на главной: витрина не знает адреса
 * провайдера, а гость не ждёт его — экран читает кэш, собранный в фоне.
 *
 * ЕДИНИЦЫ. Градусы — настройка отеля (считает сервер). Ветер и давление — по
 * языку гостя: по-русски м/с и мм рт. ст., как в прогнозах, к которым он привык;
 * на остальных языках км/ч и гПа.
 */

type Range = 'now' | 'week' | 'fortnight' | 'month' | 'season';
const RANGES: Range[] = ['now', 'week', 'fortnight', 'month', 'season'];

/**
 * ВЫБРАННЫЙ ГОРОД — В АДРЕСЕ СТРАНИЦЫ (партия 65): `?city=…&lat=…&lon=…`.
 * Так работают «назад» и обновление страницы, а ссылкой можно поделиться.
 * Нет параметров — погода отеля.
 */
function usePlace(): [WeatherPlace | null, (next: WeatherPlace | null) => void] {
  const [params, setParams] = useSearchParams();
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const name = params.get('city') ?? '';
  const place = params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) ? { name, latitude: lat, longitude: lon } : null;
  const set = (next: WeatherPlace | null) =>
    setParams(next ? { city: next.name, lat: String(next.latitude), lon: String(next.longitude) } : {}, { replace: false });
  return [place, set];
}

export function WeatherPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [place, setPlace] = usePlace();
  const { data, isLoading } = useGuestWeather(place);
  const [range, setRange] = useState<Range>('now');

  const header = (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
      <ButtonBase
        onClick={() => navigate('/home')}
        aria-label={t('guest.common.back')}
        data-testid="guest-weather-back"
        sx={{ width: 40, height: 40, borderRadius: '50%', flex: 'none' }}
      >
        <IconBack size={20} />
      </ButtonBase>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {t('guest.weatherPage.title')}
        </Typography>
        {data?.city || place?.name ? (
          <Typography variant="body2" color="text.secondary" data-testid="guest-weather-city">
            {place?.name || data?.city}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
  const search = data?.search ? (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
      <CitySearch onPick={(city) => setPlace({ name: city.name, latitude: city.latitude, longitude: city.longitude })} />
      {place ? (
        <Button variant="outlined" onClick={() => setPlace(null)} data-testid="guest-weather-hotel" sx={{ flex: 'none' }}>
          {t('guest.weatherPage.backToHotel')}
        </Button>
      ) : null}
    </Stack>
  ) : null;

  if (isLoading || (data?.pending && !data.weather)) {
    return (
      <Container maxWidth="md" sx={{ py: 2 }} data-testid="guest-weather">
        {header}
        {search}
        <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }} data-testid="guest-weather-pending">
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            {t('guest.weatherPage.loading')}
          </Typography>
        </Stack>
      </Container>
    );
  }

  if (!data?.weather) {
    return (
      <Container maxWidth="md" sx={{ py: 2 }} data-testid="guest-weather">
        {header}
        {search}
        <EmptyState
          title={t('guest.weatherPage.emptyTitle')}
          description={t('guest.weatherPage.emptyHint')}
          testId="guest-weather-empty"
        />
      </Container>
    );
  }

  const weather = data.weather;
  return (
    <Container maxWidth="md" sx={{ py: 2, pb: { xs: 6, md: 8 } }} data-testid="guest-weather">
      {header}
      {search}
      <Now weather={weather} />
      <Tabs
        value={range}
        onChange={(_event, value: Range) => setRange(value)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mt: 2, mb: 1.5 }}
        data-testid="guest-weather-ranges"
      >
        {RANGES.map((value) => (
          <Tab key={value} value={value} label={t(`guest.weatherPage.range.${value}`)} data-testid={`guest-weather-range-${value}`} />
        ))}
      </Tabs>
      {range === 'now' ? (
        <Stack spacing={2}>
          <Hours hours={weather.hourly} units={weather.units} />
          <Details weather={weather} />
          {weather.marine ? <Marine weather={weather} /> : null}
          {weather.air ? <Air weather={weather} /> : null}
        </Stack>
      ) : null}
      {range === 'week' ? <Days days={weather.daily.slice(0, 7)} units={weather.units} /> : null}
      {range === 'fortnight' ? <Days days={weather.daily} units={weather.units} /> : null}
      {range === 'month' ? (
        <Stack spacing={2}>
          <Days days={weather.daily} units={weather.units} />
          <Outlook days={weather.outlook} units={weather.units} />
        </Stack>
      ) : null}
      {range === 'season' ? <Months months={weather.months} units={weather.units} /> : null}
      <Updated at={weather.fetched_at} />
    </Container>
  );
}

/* ── Поиск города ─────────────────────────────────────────────────────────── */

/**
 * Только города, по всему миру — подсказки DaData через наш сервер (ключ
 * в браузер не попадает). Запрос уходит с двух букв и после паузы в наборе.
 */
function CitySearch({ onPick }: { onPick: (city: WeatherCity) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(text), 300);
    return () => window.clearTimeout(id);
  }, [text]);
  const { data, isFetching } = useWeatherCities(query);
  const options = data?.cities ?? [];
  const failed = data?.cities === null;
  return (
    <Autocomplete<WeatherCity, false, false, false>
      fullWidth
      size="small"
      options={options}
      filterOptions={(items) => items}
      getOptionLabel={(city) => city.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      loading={isFetching}
      inputValue={text}
      onInputChange={(_event, value) => setText(value)}
      onChange={(_event, city) => {
        if (city) {
          onPick(city);
          setText('');
        }
      }}
      value={null}
      noOptionsText={query.trim().length < 2 ? t('guest.weatherPage.searchHint') : failed ? t('guest.weatherPage.searchFailed') : t('guest.weatherPage.searchNothing')}
      loadingText={t('guest.common.loading')}
      renderOption={(props, city) => (
        <Box component="li" {...props} key={city.id} data-testid="guest-weather-city-option">
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {city.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {[city.region, city.country].filter(Boolean).join(', ')}
            </Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={t('guest.weatherPage.searchPlaceholder')}
          inputProps={{ ...params.inputProps, 'data-testid': 'guest-weather-search' }}
        />
      )}
    />
  );
}

/* ── Оформление ───────────────────────────────────────────────────────────── */

function Card({ title, testId, hint, children }: { title?: string; testId?: string; hint?: string; children: ReactNode }) {
  const { cardSurface } = useStorefront();
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        ...cardSurfaceCss(cardSurface, theme),
        borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        p: { xs: 1.5, md: 2 },
      })}
    >
      {title ? (
        <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: 'block', lineHeight: 1.6 }}>
          {title}
        </Typography>
      ) : null}
      {hint ? (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          {hint}
        </Typography>
      ) : null}
      {children}
    </Box>
  );
}

function ConditionIcon({ code, isDay = true, size = 22 }: { code: number | null; isDay?: boolean; size?: number }) {
  const condition = conditionOf(code ?? -1);
  const Icon = condition.key === 'clear' && !isDay ? IconMoon : condition.Icon;
  return (
    <Box sx={{ display: 'flex', color: 'primary.main' }} aria-hidden>
      <Icon size={size} />
    </Box>
  );
}

/* ── Единицы и подписи ────────────────────────────────────────────────────── */

function useFormat(units: 'c' | 'f') {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const metricRu = language.startsWith('ru');
  return useMemo(() => {
    const degrees = (value: number | null | undefined) => (value == null ? '—' : `${Math.round(value)}°`);
    const temperature = (value: number | null | undefined) =>
      value == null ? '—' : t('guest.weather.degrees', { value: Math.round(value), unit: units.toUpperCase() });
    const wind = (ms: number | null | undefined) =>
      ms == null ? '—' : metricRu ? t('guest.weatherPage.unit.ms', { value: Math.round(ms) }) : t('guest.weatherPage.unit.kmh', { value: Math.round(ms * 3.6) });
    const pressure = (hpa: number | null | undefined) =>
      hpa == null ? '—' : metricRu ? t('guest.weatherPage.unit.mmhg', { value: Math.round(hpa * 0.750062) }) : t('guest.weatherPage.unit.hpa', { value: Math.round(hpa) });
    const direction = (degrees: number | null | undefined) => {
      if (degrees == null) return '';
      const points = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
      return t(`guest.weatherPage.dir.${points[Math.round(((degrees % 360) + 360) % 360 / 45) % 8]}`);
    };
    const date = (iso: string, options: Intl.DateTimeFormatOptions) => {
      const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
      try {
        return new Intl.DateTimeFormat(language, { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d || 1)));
      } catch {
        return iso.slice(0, 10);
      }
    };
    const hours = (seconds: number | null | undefined) => {
      if (seconds == null) return '—';
      const h = Math.floor(seconds / 3600);
      const m = Math.round((seconds % 3600) / 60);
      return t('guest.weatherPage.unit.duration', { h, m });
    };
    return { degrees, temperature, wind, pressure, direction, date, hours, mm: (v: number | null | undefined) => (v == null ? '—' : t('guest.weatherPage.unit.mm', { value: Math.round(v * 10) / 10 })) };
  }, [t, language, metricRu, units]);
}

function uvLevel(uv: number | null | undefined): string {
  if (uv == null) return '';
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'veryHigh';
  return 'extreme';
}

function aqiLevel(aqi: number | null | undefined): string {
  // Европейский индекс: 0–20 хорошо … больше 100 — крайне плохо.
  if (aqi == null) return '';
  if (aqi <= 20) return 'good';
  if (aqi <= 40) return 'fair';
  if (aqi <= 60) return 'moderate';
  if (aqi <= 80) return 'poor';
  if (aqi <= 100) return 'veryPoor';
  return 'extremelyPoor';
}

/* ── Сейчас ───────────────────────────────────────────────────────────────── */

function Now({ weather }: { weather: WeatherDetail }) {
  const { t } = useTranslation();
  const f = useFormat(weather.units);
  const now = weather.current;
  const today = weather.daily[0];
  if (!now) return null;
  const condition = conditionOf(now.code ?? -1);
  return (
    <Card testId="guest-weather-now">
      <Stack direction="row" alignItems="center" spacing={2}>
        <ConditionIcon code={now.code} isDay={now.is_day} size={44} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: fontPx(40), fontWeight: 700, lineHeight: 1.1 }} data-testid="guest-weather-now-temp">
            {f.temperature(now.temperature_c)}
          </Typography>
          <Typography variant="body1">{t(`guest.weather.${condition.key}`)}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('guest.weatherPage.feels', { value: f.degrees(now.apparent_c) })}
            {today ? ` · ${t('guest.weatherPage.maxMin', { max: f.degrees(today.max_c), min: f.degrees(today.min_c) })}` : ''}
          </Typography>
        </Box>
      </Stack>
    </Card>
  );
}

function Hours({ hours, units }: { hours: WeatherHour[]; units: 'c' | 'f' }) {
  const { t } = useTranslation();
  const f = useFormat(units);
  if (!hours.length) return null;
  return (
    <Card title={t('guest.weatherPage.hourly')} testId="guest-weather-hours">
      <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 0.5, scrollbarWidth: 'thin' }}>
        {hours.map((hour) => (
          <Stack key={hour.time} alignItems="center" spacing={0.5} sx={{ minWidth: 52 }} data-testid="guest-weather-hour">
            <Typography variant="caption" color="text.secondary">
              {hour.time.slice(11, 16) === '00:00' ? f.date(hour.time, { weekday: 'short' }) : hour.time.slice(11, 16)}
            </Typography>
            <ConditionIcon code={hour.code} isDay={hour.is_day} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {f.degrees(hour.temperature_c)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ visibility: hour.precipitation_probability ? 'visible' : 'hidden' }}>
              {hour.precipitation_probability ?? 0}%
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

function Fact({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <Box data-testid={testId} sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary" component="div">
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' } }}>{children}</Box>;
}

function Details({ weather }: { weather: WeatherDetail }) {
  const { t } = useTranslation();
  const f = useFormat(weather.units);
  const now = weather.current;
  const today = weather.daily[0];
  if (!now) return null;
  const uv = uvLevel(now.uv_index);
  return (
    <Card title={t('guest.weatherPage.details')} testId="guest-weather-details">
      <Facts>
        <Fact label={t('guest.weatherPage.wind')} value={`${f.wind(now.wind_ms)} ${f.direction(now.wind_dir)}`.trim()} hint={now.gusts_ms != null ? t('guest.weatherPage.gusts', { value: f.wind(now.gusts_ms) }) : undefined} testId="guest-weather-wind" />
        <Fact label={t('guest.weatherPage.humidity')} value={now.humidity == null ? '—' : `${now.humidity}%`} hint={t('guest.weatherPage.dewPoint', { value: f.degrees(now.dew_point_c) })} />
        <Fact label={t('guest.weatherPage.pressure')} value={f.pressure(now.pressure_hpa)} testId="guest-weather-pressure" />
        <Fact label={t('guest.weatherPage.uv')} value={now.uv_index == null ? '—' : String(Math.round(now.uv_index))} hint={uv ? t(`guest.weatherPage.uvLevel.${uv}`) : undefined} />
        <Fact label={t('guest.weatherPage.clouds')} value={now.cloud_cover == null ? '—' : `${now.cloud_cover}%`} />
        <Fact label={t('guest.weatherPage.visibility')} value={now.visibility_m == null ? '—' : t('guest.weatherPage.unit.km', { value: Math.round(now.visibility_m / 1000) })} />
        <Fact label={t('guest.weatherPage.precipitation')} value={f.mm(today?.precipitation_mm ?? now.precipitation_mm)} hint={today?.precipitation_probability != null ? t('guest.weatherPage.chance', { value: today.precipitation_probability }) : undefined} />
        {today ? (
          <Fact
            label={t('guest.weatherPage.sun')}
            value={`${today.sunrise?.slice(11, 16) ?? '—'} – ${today.sunset?.slice(11, 16) ?? '—'}`}
            hint={t('guest.weatherPage.daylight', { value: f.hours(today.daylight_s) })}
            testId="guest-weather-sun"
          />
        ) : null}
      </Facts>
    </Card>
  );
}

function Marine({ weather }: { weather: WeatherDetail }) {
  const { t } = useTranslation();
  const f = useFormat(weather.units);
  const marine = weather.marine!;
  return (
    <Card title={t('guest.weatherPage.sea')} testId="guest-weather-sea">
      <Facts>
        <Fact label={t('guest.weatherPage.water')} value={f.temperature(marine.sea_c)} testId="guest-weather-water" />
        <Fact label={t('guest.weatherPage.waves')} value={marine.wave_m == null ? '—' : t('guest.weatherPage.unit.m', { value: marine.wave_m.toFixed(1) })} hint={f.direction(marine.wave_dir)} />
        <Fact label={t('guest.weatherPage.wavePeriod')} value={marine.wave_period_s == null ? '—' : t('guest.weatherPage.unit.s', { value: Math.round(marine.wave_period_s) })} />
      </Facts>
      {marine.daily.length ? (
        <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', mt: 2 }}>
          {marine.daily.map((day) => (
            <Stack key={day.date} alignItems="center" sx={{ minWidth: 56 }}>
              <Typography variant="caption" color="text.secondary">
                {f.date(day.date, { weekday: 'short' })}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {day.wave_max_m == null ? '—' : t('guest.weatherPage.unit.m', { value: day.wave_max_m.toFixed(1) })}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Card>
  );
}

function Air({ weather }: { weather: WeatherDetail }) {
  const { t } = useTranslation();
  const air = weather.air!;
  const level = aqiLevel(air.european_aqi);
  const micro = (value: number | null) => (value == null ? '—' : t('guest.weatherPage.unit.ugm3', { value: Math.round(value) }));
  const pollen = Object.entries(air.pollen ?? {}).filter(([, value]) => value > 0);
  return (
    <Card title={t('guest.weatherPage.air')} testId="guest-weather-air">
      <Facts>
        <Fact label={t('guest.weatherPage.aqi')} value={air.european_aqi == null ? '—' : String(air.european_aqi)} hint={level ? t(`guest.weatherPage.aqiLevel.${level}`) : undefined} testId="guest-weather-aqi" />
        <Fact label="PM2.5" value={micro(air.pm2_5)} />
        <Fact label="PM10" value={micro(air.pm10)} />
        <Fact label={t('guest.weatherPage.ozone')} value={micro(air.ozone)} />
        <Fact label={t('guest.weatherPage.no2')} value={micro(air.nitrogen_dioxide)} />
        {air.us_aqi != null ? <Fact label={t('guest.weatherPage.usAqi')} value={String(air.us_aqi)} /> : null}
      </Facts>
      {pollen.length ? (
        <Typography variant="body2" sx={{ mt: 1.5 }} data-testid="guest-weather-pollen">
          {t('guest.weatherPage.pollen')}: {pollen.map(([name, value]) => `${t(`guest.weatherPage.pollenKind.${name}`)} ${Math.round(value)}`).join(', ')}
        </Typography>
      ) : null}
    </Card>
  );
}

/* ── Дни ──────────────────────────────────────────────────────────────────── */

function Days({ days, units }: { days: WeatherDay[]; units: 'c' | 'f' }) {
  const { t } = useTranslation();
  const f = useFormat(units);
  const [open, setOpen] = useState<string>('');
  if (!days.length) return null;
  const low = Math.min(...days.map((d) => d.min_c ?? Infinity));
  const high = Math.max(...days.map((d) => d.max_c ?? -Infinity));
  return (
    <Card title={t('guest.weatherPage.daysTitle', { count: days.length })} testId="guest-weather-days">
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
        {days.map((day, index) => {
          const condition = conditionOf(day.code ?? -1);
          const expanded = open === day.date;
          return (
            <Box key={day.date} data-testid="guest-weather-day">
              <ButtonBase
                onClick={() => setOpen(expanded ? '' : day.date)}
                aria-expanded={expanded}
                sx={{ width: '100%', py: 1, display: 'grid', gridTemplateColumns: { xs: '78px 28px 1fr', sm: '120px 32px 1fr 56px' }, alignItems: 'center', gap: 1, textAlign: 'start' }}
              >
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {index === 0 ? t('guest.weatherPage.today') : f.date(day.date, { weekday: 'short' })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {f.date(day.date, { day: 'numeric', month: 'short' })}
                  </Typography>
                </Box>
                <ConditionIcon code={day.code} />
                <RangeBar min={day.min_c} max={day.max_c} low={low} high={high} f={f} label={t(`guest.weather.${condition.key}`)} />
                <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'end' }}>
                  {day.precipitation_probability ? `${day.precipitation_probability}%` : ''}
                </Typography>
              </ButtonBase>
              {expanded ? (
                <Box sx={{ pb: 1.5 }}>
                  <Facts>
                    <Fact label={t('guest.weatherPage.feelsShort')} value={`${f.degrees(day.apparent_min_c)} … ${f.degrees(day.apparent_max_c)}`} />
                    <Fact label={t('guest.weatherPage.precipitation')} value={f.mm(day.precipitation_mm)} hint={day.precipitation_probability != null ? t('guest.weatherPage.chance', { value: day.precipitation_probability }) : undefined} />
                    <Fact label={t('guest.weatherPage.wind')} value={`${f.wind(day.wind_max_ms)} ${f.direction(day.wind_dir)}`.trim()} hint={day.gusts_max_ms != null ? t('guest.weatherPage.gusts', { value: f.wind(day.gusts_max_ms) }) : undefined} />
                    <Fact label={t('guest.weatherPage.uv')} value={day.uv_max == null ? '—' : String(Math.round(day.uv_max))} hint={day.uv_max != null ? t(`guest.weatherPage.uvLevel.${uvLevel(day.uv_max)}`) : undefined} />
                    <Fact label={t('guest.weatherPage.sun')} value={`${day.sunrise?.slice(11, 16) ?? '—'} – ${day.sunset?.slice(11, 16) ?? '—'}`} hint={t('guest.weatherPage.sunshine', { value: f.hours(day.sunshine_s) })} />
                  </Facts>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Stack>
    </Card>
  );
}

function RangeBar({ min, max, low, high, f, label }: { min: number | null; max: number | null; low: number; high: number; f: ReturnType<typeof useFormat>; label: string }) {
  const span = Math.max(1, high - low);
  const from = min == null ? 0 : ((min - low) / span) * 100;
  const to = max == null ? 100 : ((max - low) / span) * 100;
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }} aria-label={`${label}, ${f.degrees(min)} … ${f.degrees(max)}`}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 34, textAlign: 'end', flex: 'none' }}>
        {f.degrees(min)}
      </Typography>
      <Box sx={{ position: 'relative', flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover' }}>
        <Box style={{ insetInlineStart: `${from}%`, width: `${Math.max(4, to - from)}%` }} sx={(theme) => ({ position: 'absolute', top: 0, bottom: 0, borderRadius: 3, background: `linear-gradient(90deg, ${theme.palette.info.main}, ${theme.palette.warning.main})` })} />
      </Box>
      <Typography variant="body2" sx={{ width: 34, fontWeight: 700, flex: 'none' }}>
        {f.degrees(max)}
      </Typography>
    </Stack>
  );
}

function Outlook({ days, units }: { days: WeatherOutlookDay[]; units: 'c' | 'f' }) {
  const { t } = useTranslation();
  const f = useFormat(units);
  if (!days.length) return null;
  return (
    <Card title={t('guest.weatherPage.outlookTitle', { count: days.length })} hint={t('guest.weatherPage.outlookHint')} testId="guest-weather-outlook">
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
        {days.map((day) => (
          <Box key={day.date} data-testid="guest-weather-outlook-day" sx={{ py: 0.75, display: 'grid', gridTemplateColumns: { xs: '72px 1fr 40px', sm: '120px 1fr 64px' }, alignItems: 'center', gap: 1 }}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {f.date(day.date, { weekday: 'short' })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {f.date(day.date, { day: 'numeric', month: 'short' })}
              </Typography>
            </Box>
            <Typography variant="body2">
              {t('guest.weatherPage.outlookRow', { max: f.degrees(day.max_c), min: f.degrees(day.min_c), low: f.degrees(day.max_low_c), high: f.degrees(day.max_high_c) })}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'end' }}>
              {day.precipitation_probability != null ? `${day.precipitation_probability}%` : ''}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Card>
  );
}

function Months({ months, units }: { months: WeatherMonth[]; units: 'c' | 'f' }) {
  const { t } = useTranslation();
  const f = useFormat(units);
  if (!months.length) return null;
  return (
    <Card title={t('guest.weatherPage.monthsTitle')} hint={t('guest.weatherPage.monthsHint')} testId="guest-weather-months">
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' } }}>
        {months.map((month) => (
          <Box key={month.month} data-testid="guest-weather-month" sx={{ p: 1.25, borderRadius: 2, border: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {capitalize(f.date(`${month.month}-01`, { month: 'long' }))}{' '}
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                {month.month.slice(0, 4)}
              </Box>
            </Typography>
            <Typography sx={{ fontSize: fontPx(26), fontWeight: 700, lineHeight: 1.2 }}>{f.degrees(month.temperature_c)}</Typography>
            {month.anomaly_c != null ? (
              <Typography variant="caption" color="text.secondary" component="div">
                {t('guest.weatherPage.anomaly', { value: `${month.anomaly_c > 0 ? '+' : ''}${month.anomaly_c.toFixed(1)}°` })}
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary" component="div">
              {t('guest.weatherPage.monthRain', { value: f.mm(month.precipitation_mm) })}
            </Typography>
            {month.sea_c != null ? (
              <Typography variant="caption" color="text.secondary" component="div">
                {t('guest.weatherPage.monthSea', { value: f.degrees(month.sea_c) })}
              </Typography>
            ) : null}
            {month.sunshine_h != null ? (
              <Typography variant="caption" color="text.secondary" component="div">
                {t('guest.weatherPage.monthSun', { value: month.sunshine_h })}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Box>
    </Card>
  );
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

function Updated({ at }: { at: string }) {
  const { t, i18n } = useTranslation();
  const time = (() => {
    try {
      return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
    } catch {
      return '';
    }
  })();
  return (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, fontSize: fontPx(11) }} data-testid="guest-weather-source">
      {t('guest.weatherPage.updated', { time })} · {t('guest.weather.source')}
    </Typography>
  );
}
