import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { IconForward, IconOffline } from '@/icons';
import { useRoomState } from '../hooks/useRoomControl';
import { useGuestSession } from '../session/GuestSessionProvider';
import { storefrontTokens, surfaceRadius } from '../storefrontTokens';
import { RoomStatusPills } from './RoomStatusPills';

/**
 * Состояние номера на главной: та же строка пилюль, что на экране номера.
 *
 * ИСТОЧНИК ТОТ ЖЕ, И ЭТО ГЛАВНОЕ. Снимок берётся `useRoomState` — тем самым
 * запросом с тем самым ключом кэша, которым живёт экран номера. Второго
 * источника данных о номере в продукте нет: разойдись они, гость увидел бы на
 * главной «две зоны горят», а через секунду на экране номера — другое, и
 * поверить после этого нельзя было бы ни одному экрану.
 *
 * ТРИ УСЛОВИЯ ПОКАЗА, и все три — про право, а не про красоту: модуль
 * управления включён отелю, в сессии есть номер, отель не выключил строку в
 * настройках главной. Нет любого — строки нет вовсе.
 *
 * НЕ УТЯЖЕЛЯЕТ ГЛАВНУЮ. Пока снимок не пришёл, строки просто нет: ни
 * скелетона, ни зарезервированного места. Главная — это витрина отеля, и
 * заставлять её ждать оборудование в номере незачем.
 *
 * В ОФФЛАЙНЕ НЕ ВРЁТ. Состояние не читается — вместо пилюль одна честная
 * строка «сейчас недоступно». Показать последние известные значения было бы
 * тем же обманом, что и выключенный свет включённым.
 */
export function HomeRoomStatus({ allowed = true }: { allowed?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const calm = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { hotel, session } = useGuestSession();

  const gated = Boolean(allowed && hotel?.room_control_enabled && session?.room);
  const { data: snapshot, isPending, isError } = useRoomState(gated);

  if (!gated || isPending || isError || !snapshot) return null;

  const unavailable = snapshot.availability === 'unavailable';

  return (
    <ButtonBase
      data-testid="guest-home-room-status"
      data-available={unavailable ? 'false' : 'true'}
      onClick={() => navigate('/room')}
      aria-label={t('guest.home.roomStrip.open')}
      sx={(theme) => ({
        ...storefrontTokens(theme.palette.mode).glass.panel,
        borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        width: '100%',
        px: { xs: 1.5, md: 2 },
        py: { xs: 1, md: 1.25 },
        gap: 1.5,
        justifyContent: 'space-between',
        textAlign: 'start',
        transition: calm ? 'none' : 'background .2s ease, border-color .2s ease, transform .12s ease',
        // Наведение — только там, где есть чем наводить: на телефоне `:hover`
        // залипает на последнем нажатом элементе до следующего касания.
        '@media (hover: hover)': {
          '&:hover': { borderColor: theme.palette.primary.main },
        },
        '&:active': { transform: calm ? 'none' : 'scale(.995)' },
        '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        animation: calm ? 'none' : 'homeBlockIn .28s ease both',
        '@keyframes homeBlockIn': {
          from: { opacity: 0, transform: 'translateY(-4px)' },
          to: { opacity: 1, transform: 'none' },
        },
      })}
    >
      <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.5}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
          {t('guest.home.roomStrip.title')}
        </Typography>
        {unavailable ? (
          <Stack direction="row" alignItems="center" spacing={0.75} data-testid="guest-home-room-offline">
            <IconOffline size={14} />
            <Typography variant="body2" color="text.secondary">
              {t('guest.home.roomStrip.offline')}
            </Typography>
          </Stack>
        ) : (
          <RoomStatusPills snapshot={snapshot} />
        )}
      </Stack>
      <IconForward size={18} />
    </ButtonBase>
  );
}
