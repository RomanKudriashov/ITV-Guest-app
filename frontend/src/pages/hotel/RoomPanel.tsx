/**
 * Боковая панель номера — то, что открывается кликом по кубику.
 *
 * ПАНЕЛЬ, А НЕ ДИАЛОГ, и это не вкусовщина: сетка должна остаться слева и
 * читаемой. Человек смотрит на этаж, открывает номер, меняет категорию и
 * продолжает смотреть на тот же этаж — диалог накрыл бы ровно то, ради чего он
 * сюда пришёл.
 *
 * На телефоне панель приезжает снизу карточкой: справа там нет места, а
 * накрывать экран целиком — то же самое, что диалог.
 */
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';

import { ApiError } from '@/api/client';
import { cmsPath } from '@/app/hostRole';
import { updateRoom } from '@/api/hotelAdmin';
import type { Building, GridRoom, RoomCategory, RoomHousekeeping } from '@/api/hotelAdminTypes';
import { useToast } from '@/components/ToastProvider';

const HOUSEKEEPING: RoomHousekeeping[] = ['unknown', 'clean', 'dirty', 'in_progress'];

export function RoomPanel({
  room,
  categories,
  buildings,
  onClose,
  onChanged,
  onShowQr,
}: {
  room: GridRoom;
  categories: RoomCategory[];
  buildings: Building[];
  onClose: () => void;
  onChanged: () => void;
  onShowQr: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));

  const patch = useMutation({
    mutationFn: (data: {
      category_id?: string | null;
      building_id?: string | null;
      housekeeping?: RoomHousekeeping;
    }) =>
      updateRoom(room.id, data),
    onSuccess: () => {
      toast.show(t('hotel.rooms.saved'), 'success');
      onChanged();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  return (
    <Drawer
      open
      anchor={isPhone ? 'bottom' : 'right'}
      onClose={onClose}
      /* Модальность выключена на широком экране: сетка слева остаётся живой,
         по ней можно продолжать водить глазами и кликать. */
      variant={isPhone ? 'temporary' : 'persistent'}
      PaperProps={{
        sx: isPhone
          ? { borderTopLeftRadius: 12, borderTopRightRadius: 12, p: 2, maxHeight: '80vh' }
          : {
              width: 340,
              p: 2,
              /*
                ПАНЕЛЬ НАЧИНАЕТСЯ ПОД ШАПКОЙ, а не от верха окна.

                Шапка CMS зафиксирована, и панель, начинавшаяся от нуля,
                уезжала под неё: заголовок с номером и кнопка закрытия
                оказывались недоступны — по ним просто не попадал курсор.
                Поймано проверкой, которая пыталась закрыть панель.
              */
              top: { xs: 56, sm: 64 },
              height: { xs: 'calc(100% - 56px)', sm: 'calc(100% - 64px)' },
              overflowY: 'auto',
            },
        'data-testid': 'room-panel',
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }} data-testid="room-panel-number">
          {room.number}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('common.close')} data-testid="room-panel-close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {t('hotel.rooms.floorTitle', { floor: room.floor || '—' })}
          {room.zone ? ` · ${room.zone}` : ''}
        </Typography>
        {/* Занятость не показываем ВООБЩЕ: её нет, и пустая строка «занят: —»
            читалась бы как поломка, а не как отсутствие источника. */}
        <Typography variant="body2">
          {t('hotel.rooms.hintOrders', { count: room.active_orders, overdue: room.overdue_orders })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('hotel.rooms.hintDevice')}: {t(`hotel.rooms.device_${room.device ?? 'none'}`)}
        </Typography>
      </Stack>

      <Divider sx={{ my: 1 }} />

      <Stack spacing={2}>
        <TextField
          select
          size="small"
          label={t('hotel.rooms.category')}
          value={room.category_id ?? ''}
          onChange={(event) =>
            patch.mutate({ category_id: event.target.value ? event.target.value : null })
          }
          SelectProps={{ native: true }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'room-panel-category' }}
          disabled={patch.isPending}
          fullWidth
        >
          <option value="">{t('hotel.rooms.categoryNone')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.title_i18n || category.code}
            </option>
          ))}
        </TextField>

        {/*
          КОРПУС — ИЗ СПРАВОЧНИКА. Раньше это была свободная строка, и
          «Главный корпус», «главный корпус» и «Гл. корпус» жили как три
          разных здания: фильтр делил фонд на три части, а здание было одно.
        */}
        <TextField
          select
          size="small"
          label={t('hotel.rooms.building')}
          value={room.building_id ?? ''}
          onChange={(event) =>
            patch.mutate({ building_id: event.target.value ? event.target.value : null })
          }
          SelectProps={{ native: true }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'room-panel-building' }}
          disabled={patch.isPending}
          fullWidth
        >
          <option value="">{t('hotel.rooms.buildingNone')}</option>
          {buildings.map((building) => (
            <option key={building.id} value={building.id}>
              {building.title_i18n || building.code}
            </option>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label={t('hotel.rooms.housekeeping')}
          value={room.housekeeping}
          onChange={(event) =>
            patch.mutate({ housekeeping: event.target.value as RoomHousekeeping })
          }
          SelectProps={{ native: true }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'room-panel-housekeeping' }}
          disabled={patch.isPending}
          fullWidth
        >
          {HOUSEKEEPING.map((value) => (
            <option key={value} value={value}>
              {t(`hotel.rooms.housekeeping_${value}`)}
            </option>
          ))}
        </TextField>

        <Stack spacing={1}>
          <Button
            component={RouterLink}
            to={cmsPath(`/orders?room=${encodeURIComponent(room.number)}`)}
            variant="outlined"
            size="small"
            data-testid="room-panel-orders"
          >
            {t('hotel.rooms.panelOrders')}
          </Button>
          <Button variant="outlined" size="small" onClick={onShowQr} data-testid="room-panel-qr">
            {t('hotel.rooms.qr')}
          </Button>
          {/* Управление номером — только когда номер и правда управляется:
              кнопка в никуда хуже, чем её отсутствие. */}
          {room.control_type ? (
            <Button
              component={RouterLink}
              to={cmsPath(`/room-control?type=${encodeURIComponent(room.control_type)}`)}
              variant="outlined"
              size="small"
              data-testid="room-panel-control"
            >
              {t('hotel.rooms.panelControl')}
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t('hotel.rooms.panelNoControl')}
            </Typography>
          )}
        </Stack>

        <Box>
          <Typography variant="caption" color="text.secondary">
            {t('hotel.rooms.panelGuestUrl')}
          </Typography>
          <Link
            href={room.guest_url}
            target="_blank"
            rel="noreferrer"
            variant="body2"
            sx={{ wordBreak: 'break-all' }}
            data-testid="room-panel-guest-url"
          >
            {room.guest_url}
          </Link>
        </Box>
      </Stack>
    </Drawer>
  );
}

export default RoomPanel;
