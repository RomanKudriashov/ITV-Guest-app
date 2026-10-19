import type { ReactNode } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { TFunction } from 'i18next';

import { cmsPath } from '@/app/hostRole';
import type { StaffUser } from '@/api/types';
import {
  IconBed,
  IconMakeUpRoom,
  IconOrders,
  IconRestaurant,
  IconStatusAccepted,
  IconStatusDone,
  IconStatusNew,
  IconStatusPreparing,
  IconStatusReady,
  IconWifi,
} from '@/icons';
import { KitImage } from '@/kit';

import type { CardData, EntityType, OrderCardData, RoomCardData, VenueCardData } from './api';
import { toneColor, toneText, type CardAction, type EntityCardModel, type Tone } from './EntityCardView';

/**
 * РЕЕСТР КАРТОЧЕК ПО ТИПАМ (партия 59а): данные ручки → вид v2.
 *
 * Карточка типа собирается ЗДЕСЬ и только здесь — экраны пишут
 * `<EntityName type="order" id=…>` и не знают, что внутри. Так карточка одна
 * и та же на любом экране.
 *
 * Поля карточки на сервере сверены с полями сущности (`CARD_FIELDS`): новое
 * поле приходит сюда через сторож `test_cards.py`, а не через память.
 */

export interface CardContext {
  t: TFunction;
  user: StaffUser | null | undefined;
  money: (minor: number, currency: string) => string;
  /** Главное действие заказа — следующий статус. */
  advance: (order: OrderCardData, code: string) => void;
  busy: boolean;
}

function Tile({ children, tone = 'info' }: { children: ReactNode; tone?: Tone }) {
  return (
    <Box
      sx={(theme) => ({
        width: 52,
        height: 52,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 2.5,
        color: toneText(theme, tone),
        bgcolor: alpha(toneColor(theme, tone), theme.palette.mode === 'light' ? 0.12 : 0.2),
        '& svg': { width: 28, height: 28 },
      })}
    >
      {children}
    </Box>
  );
}

const STAGE_ICON: Record<string, typeof IconStatusNew> = {
  new: IconStatusNew,
  accepted: IconStatusAccepted,
  preparing: IconStatusPreparing,
  ready: IconStatusReady,
  done: IconStatusDone,
};

function StageScale({ stages, late }: { stages: OrderCardData['stages']; late: boolean }) {
  const at = stages.findIndex((stage) => stage.current);
  return (
    <Box data-testid="entity-card-stages">
      <Stack direction="row" spacing={0.5}>
        {stages.map((stage, index) => (
          <Box
            key={stage.code}
            sx={(theme) => ({
              flex: 1,
              height: 6,
              borderRadius: 3,
              bgcolor:
                index <= at
                  ? late
                    ? theme.palette.error.main
                    : theme.palette.primary.main
                  : alpha(theme.palette.text.primary, theme.palette.mode === 'light' ? 0.14 : 0.2),
            })}
          />
        ))}
      </Stack>
      {at >= 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {stages.map((stage) => stage.title).join(' → ')}
        </Typography>
      ) : null}
    </Box>
  );
}

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function orderModel(order: OrderCardData, ctx: CardContext): EntityCardModel {
  const { t } = ctx;
  const late = order.due_in_minutes !== null && order.due_in_minutes < 0;
  const terminal = order.status.is_terminal;
  const tone: Tone = order.status.is_cancelled ? 'error' : terminal ? 'success' : late ? 'error' : 'warning';
  const StatusIcon = STAGE_ICON[order.status.code];
  const where = order.room
    ? t('entityCard.order.title', { number: order.number, room: order.room })
    : t('entityCard.order.titleNoRoom', { number: order.number });
  const mode = t(`entityCard.order.mode.${order.delivery_mode}`, { defaultValue: '' });
  const lines =
    order.lines.map((line) => `${line.quantity}× ${line.title}`).join(' · ') +
    (order.lines_more ? ` ${t('entityCard.order.more', { count: order.lines_more })}` : '');
  const next = order.next_statuses[0];
  const primary: CardAction | null =
    !terminal && next && order.rights.move
      ? {
          label: next.title,
          onClick: () => ctx.advance(order, next.code),
          busy: ctx.busy,
          testId: 'entity-card-primary',
        }
      : null;
  return {
    kind: t('entityCard.kind.order'),
    title: where,
    subtitle: [order.venue.title, mode || order.location].filter(Boolean).join(' · '),
    tile: (
      <Tile tone={late ? 'error' : 'info'}>
        <IconOrders />
      </Tile>
    ),
    status: { label: order.status.title, tone, icon: StatusIcon ? <StatusIcon /> : undefined },
    hero:
      order.due_in_minutes === null
        ? undefined
        : late
          ? {
              text: t('entityCard.order.late', { minutes: -order.due_in_minutes }),
              caption: t('entityCard.order.lateCaption', { time: order.due_at }),
              tone: 'error',
            }
          : {
              text: t('entityCard.order.left', { minutes: order.due_in_minutes }),
              caption: t('entityCard.order.leftCaption', { time: order.due_at }),
              tone: order.due_in_minutes <= 5 ? 'warning' : 'neutral',
            },
    extra: (
      <Stack spacing={1.25}>
        {order.stages.length ? <StageScale stages={order.stages} late={late} /> : null}
        {lines ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ typography: 'body1', fontWeight: 500 }}>
            <IconRestaurant size={20} />
            <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{lines}</Box>
          </Stack>
        ) : null}
        <Stack direction="row" spacing={1} alignItems="center">
          {order.assignee ? (
            <>
              <Avatar sx={{ width: 28, height: 28, fontSize: 13, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                {initials(order.assignee.name)}
              </Avatar>
              <Typography variant="body1" sx={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>
                {order.assignee.name}
              </Typography>
            </>
          ) : (
            <Typography variant="body1" color="text.secondary">
              {t('entityCard.order.unassigned')}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {order.total !== null ? (
            <Typography variant="body1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {ctx.money(order.total, order.currency)}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    ),
    primary,
    open: { label: t('entityCard.open.tracker'), to: `/tracker/order/${order.id}`, testId: 'entity-card-open' },
  };
}

function RoomSign({ on, icon, label, tone = 'success' }: { on: boolean; icon: ReactNode; label: string; tone?: Tone }) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={(theme) => ({
        px: 1,
        py: 0.5,
        borderRadius: 2,
        typography: 'body2',
        fontWeight: 600,
        color: on ? toneText(theme, tone) : theme.palette.text.secondary,
        bgcolor: on ? alpha(toneColor(theme, tone), theme.palette.mode === 'light' ? 0.12 : 0.2) : 'transparent',
        border: on ? '1px solid transparent' : `1px dashed ${theme.palette.divider}`,
        '& svg': { width: 18, height: 18 },
      })}
    >
      {icon}
      <span>{label}</span>
    </Stack>
  );
}

function roomModel(room: RoomCardData, ctx: CardContext): EntityCardModel {
  const { t, user } = ctx;
  const floor = room.floor ? t('entityCard.room.floor', { floor: room.floor }) : null;
  const clean = room.housekeeping === 'clean';
  const dirty = room.housekeeping === 'dirty';
  const status = room.out_of_service
    ? { label: t('entityCard.room.outOfService'), tone: 'warning' as Tone }
    : !room.is_active
      ? { label: t('entityCard.room.inactive'), tone: 'neutral' as Tone }
      : undefined;
  const primary: CardAction | null = user?.can_chat
    ? {
        label: t('entityCard.room.orderForGuest'),
        to: `/tracker/desk?room=${encodeURIComponent(room.number)}&order=1`,
        testId: 'entity-card-primary',
      }
    : user?.has_cms_access
      ? {
          label: t('entityCard.room.orders'),
          to: cmsPath(`/orders?room=${encodeURIComponent(room.number)}`),
          testId: 'entity-card-primary',
        }
      : null;
  const tasks = room.open_tasks ? ` · ${t('entityCard.room.tasks', { count: room.open_tasks })}` : '';
  return {
    kind: t('entityCard.kind.room'),
    label: t('entityCard.room.label', { number: room.number }),
    title: (
      <Box component="span" sx={{ typography: 'h3', fontWeight: 700, lineHeight: 1 }}>
        {room.number}
      </Box>
    ),
    subtitle: [room.category, floor, room.building].filter(Boolean).join(' · '),
    status,
    hero: { text: String(room.open_orders), caption: t('entityCard.room.openOrders', { count: room.open_orders }) + tasks },
    extra: (
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap data-testid="entity-card-signs">
        <RoomSign
          on={room.guest_online}
          icon={<IconBed />}
          label={room.guest_online ? t('entityCard.room.guestOnline') : t('entityCard.room.noGuest')}
        />
        <RoomSign
          on={clean || dirty || room.housekeeping === 'in_progress'}
          icon={<IconMakeUpRoom />}
          label={t(`entityCard.room.housekeeping.${room.housekeeping}`, { defaultValue: room.housekeeping })}
          tone={clean ? 'success' : 'warning'}
        />
        {room.control ? (
          <RoomSign
            on
            icon={<IconWifi />}
            label={room.control === 'online' ? t('entityCard.room.controlOnline') : t('entityCard.room.controlOffline')}
            tone={room.control === 'online' ? 'success' : 'error'}
          />
        ) : null}
      </Stack>
    ),
    primary,
    // Номерной фонд — экран администратора.
    open: user?.is_hotel_admin
      ? { label: t('entityCard.open.page'), to: cmsPath(`/rooms?search=${encodeURIComponent(room.number)}`), testId: 'entity-card-open' }
      : null,
  };
}

function venueModel(venue: VenueCardData, ctx: CardContext): EntityCardModel {
  const { t, user } = ctx;
  const schedule = venue.schedule;
  const status = !venue.is_active
    ? { label: t('entityCard.venue.inactive'), tone: 'neutral' as Tone }
    : schedule === null
      ? { label: t('entityCard.venue.always'), tone: 'success' as Tone }
      : schedule.state === 'open'
        ? {
            label: schedule.until ? t('entityCard.venue.openUntil', { time: schedule.until }) : t('entityCard.venue.open'),
            tone: 'success' as Tone,
          }
        : {
            label: schedule.opens_at ? t('entityCard.venue.opensAt', { time: schedule.opens_at }) : t('entityCard.venue.closed'),
            tone: 'warning' as Tone,
          };
  return {
    kind: t('entityCard.kind.venue'),
    title: venue.title,
    subtitle: [
      t(`services.types.${venue.kind}`, { defaultValue: '' }),
      t('entityCard.venue.items', { count: venue.items }),
    ]
      .filter(Boolean)
      .join(' · '),
    banner: venue.image ? <KitImage src={venue.image} fit="fill" alt={venue.title} sizes="320px" fill /> : undefined,
    tile: venue.image ? undefined : (
      <Tile>
        <IconRestaurant />
      </Tile>
    ),
    status,
    facts: [
      {
        icon: <IconOrders />,
        text: t('entityCard.venue.load', { inWork: venue.in_work, overdue: venue.overdue }),
        tone: venue.overdue > 0 ? 'error' : 'neutral',
      },
    ],
    primary: {
      label: t('entityCard.venue.tracker'),
      to: `/tracker?point=${encodeURIComponent(venue.point_code)}`,
      testId: 'entity-card-primary',
    },
    open: user?.has_cms_access
      ? { label: t('entityCard.open.page'), to: cmsPath(`/services/${venue.id}`), testId: 'entity-card-open' }
      : null,
  };
}

export function cardModel(data: CardData, ctx: CardContext): EntityCardModel {
  switch (data.type) {
    case 'order':
      return orderModel(data, ctx);
    case 'room':
      return roomModel(data, ctx);
    case 'venue':
      return venueModel(data, ctx);
  }
}

export type { EntityType };
