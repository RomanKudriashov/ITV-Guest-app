import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import {
  IconCloudy,
  IconFog,
  IconMoon,
  IconPartlyCloudy,
  IconRain,
  IconSnow,
  IconSunny,
  IconThunder,
  type AppIconComponent,
} from '@/icons';
import type { GuestWeather } from '../api/types';
import { storefrontTokens, surfaceRadius } from '../storefrontTokens';

/**
 * Погода отеля и его местное время.
 *
 * ПОГОДА ПРИХОДИТ ГОТОВОЙ, С СЕРВЕРА. Витрина не знает ни адреса провайдера,
 * ни его ключа и никогда к нему не обращается: у сервера один вызов на отель
 * раз в двадцать минут, а у тысячи гостей был бы миллион запросов с их IP.
 *
 * НЕТ ДАННЫХ — НЕТ БЛОКА. Провайдер молчит, координат нет, значение протухло,
 * отель погоду не включал — для экрана это один и тот же случай. Ни прочерков,
 * ни «—», ни вчерашних градусов: показать старое число под видом текущего это
 * то же враньё, что показать выключенный свет включённым.
 *
 * СОСТОЯНИЕ ПЕРЕВОДИМ САМИ. Провайдер отдаёт код WMO, а не слово: его текст
 * есть не на всех наших языках, и «Mainly clear» посреди арабского интерфейса
 * — это не погода, это брак. Код превращается в нашу строку здесь.
 *
 * АТРИБУЦИЯ — УСЛОВИЕ ЛИЦЕНЗИИ, а не подпись для красоты. Ссылка на провайдера
 * стоит рядом с данными и снимается только вместе с самим блоком.
 */

/** Группы состояний WMO: гостю нужен «дождь», а не «слабая замерзающая морось». */
function conditionOf(code: number): { key: string; Icon: AppIconComponent } {
  if (code === 0) return { key: 'clear', Icon: IconSunny };
  if (code <= 2) return { key: 'partly', Icon: IconPartlyCloudy };
  if (code === 3) return { key: 'cloudy', Icon: IconCloudy };
  if (code === 45 || code === 48) return { key: 'fog', Icon: IconFog };
  if (code >= 51 && code <= 57) return { key: 'drizzle', Icon: IconRain };
  if (code === 66 || code === 67) return { key: 'freezing', Icon: IconRain };
  if (code >= 61 && code <= 65) return { key: 'rain', Icon: IconRain };
  if (code >= 71 && code <= 77) return { key: 'snow', Icon: IconSnow };
  if (code >= 80 && code <= 82) return { key: 'showers', Icon: IconRain };
  if (code >= 85 && code <= 86) return { key: 'snow', Icon: IconSnow };
  if (code >= 95) return { key: 'thunder', Icon: IconThunder };
  return { key: 'unknown', Icon: IconCloudy };
}

/** Часы отеля: тикают сами, минутой, без единого запроса на сервер. */
function useHotelClock(timezone: string | undefined, language: string): string | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Ровно минутный шаг: секунды на главной не нужны, а таймер раз в секунду
    // будит телефон шестьдесят раз в минуту ради неизменившейся цифры.
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return useMemo(() => {
    if (!timezone) return null;
    try {
      return new Intl.DateTimeFormat(language, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      }).format(now);
    } catch {
      // Часовой пояс, которого не знает браузер: молчим, а не показываем время
      // своего устройства под видом отельного.
      return null;
    }
  }, [timezone, language, now]);
}

/** Смещение отеля и устройства совпадают — своё время гость и так видит. */
function sameOffset(timezone: string | undefined): boolean {
  if (!timezone) return true;
  try {
    const now = new Date();
    const here = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' }).format(now);
    const mine = new Intl.DateTimeFormat('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }).format(now);
    return here === mine;
  } catch {
    return true;
  }
}

export interface HomeWeatherProps {
  weather?: GuestWeather | null;
  timezone?: string;
}

export function HomeWeather({ weather, timezone }: HomeWeatherProps) {
  const { t, i18n } = useTranslation();
  const calm = useMediaQuery('(prefers-reduced-motion: reduce)');
  const clock = useHotelClock(timezone, i18n.language);

  /*
    Часы БЕЗ погоды показываются только тогда, когда они что-то говорят: гостю
    из другого пояса. Совпадает со временем его телефона — строка сообщала бы
    ему то, что он и так видит в статус-баре.
  */
  const clockWorthShowing = Boolean(clock) && !sameOffset(timezone);
  if (!weather && !clockWorthShowing) return null;

  const condition = weather ? conditionOf(weather.code) : null;
  // Ночью ясное небо рисуется луной: солнце в полночь — мелкая ложь, которую
  // видно сразу.
  const Icon = condition
    ? condition.key === 'clear' && weather && !weather.is_day
      ? IconMoon
      : condition.Icon
    : null;

  return (
    <Box
      data-testid="guest-home-weather"
      sx={(theme) => ({
        ...storefrontTokens(theme.palette.mode).glass.panel,
        borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        px: { xs: 1.5, md: 2 },
        py: { xs: 1, md: 1.25 },
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 1.25, md: 2 },
        flexWrap: 'wrap',
        // Блок появляется, когда приедет ответ сервера, и появляется мягко:
        // резкий скачок посреди уже прочитанной главной читается как сбой.
        animation: calm ? 'none' : 'homeBlockIn .28s ease both',
        '@keyframes homeBlockIn': {
          from: { opacity: 0, transform: 'translateY(-4px)' },
          to: { opacity: 1, transform: 'none' },
        },
      })}
    >
      {weather && Icon ? (
        <Stack direction="row" alignItems="center" spacing={1} data-testid="guest-home-weather-now">
          <Box sx={{ display: 'flex', color: 'primary.main' }} aria-hidden>
            <Icon size={20} />
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {/* Градусы Цельсия и точка — единица подписана знаком, а не словом:
                строка живёт в ряду, где место дороже. */}
            {t('guest.weather.degrees', {
              value: Math.round(weather.temperature_c),
              defaultValue: `${Math.round(weather.temperature_c)}°`,
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(`guest.weather.${condition!.key}`)}
          </Typography>
        </Stack>
      ) : null}

      {clock ? (
        <Stack direction="row" alignItems="baseline" spacing={0.75} data-testid="guest-home-clock">
          <Typography variant="caption" color="text.secondary">
            {t('guest.weather.localTime')}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {clock}
          </Typography>
        </Stack>
      ) : null}

      {weather ? (
        <Link
          href="https://open-meteo.com"
          target="_blank"
          rel="noopener noreferrer"
          variant="caption"
          data-testid="guest-home-weather-attribution"
          sx={{
            ml: 'auto',
            color: 'text.secondary',
            textDecorationColor: 'currentcolor',
            '@media (hover: hover)': { '&:hover': { color: 'primary.main' } },
          }}
        >
          {t('guest.weather.attribution')}
        </Link>
      ) : null}
    </Box>
  );
}
