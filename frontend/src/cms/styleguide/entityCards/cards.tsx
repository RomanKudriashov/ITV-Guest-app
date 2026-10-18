import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

import {
  IconBed,
  IconMakeUpRoom,
  IconOrders,
  IconRestaurant,
  IconStatusAccepted,
  IconStatusNew,
  IconStatusPreparing,
  IconStatusReady,
  IconThermostat,
  IconWifi,
} from '@/icons';
import { KitImage } from '@/kit';

import { toneColor, toneText, type EntityCardProps, type Tone } from './EntityCard';

/**
 * ЧЕТЫРЕ КАРТОЧКИ ОБРАЗЦА — заведение, позиция, заказ, номер (партия 59, заход 2).
 * Данные — образец полей тех типов, что уже приходят в CMS и трекер; фото и
 * названия заведения и позиции подставляет песочница из ручек CMS.
 */

export interface VenueSample {
  title: string;
  kindLabel: string;
  photo?: string | null;
  opensAt: number;
  closesAt: number;
  items: number;
  inWork: number;
  overdue: number;
}

export interface ItemSample {
  title: string;
  venue: string;
  section: string;
  photo?: string | null;
  price: string;
  inStock: boolean;
  rating: string;
  ordersWeek: number;
}

export type Stage = 'new' | 'accepted' | 'preparing' | 'ready';
const STAGES: Stage[] = ['new', 'accepted', 'preparing', 'ready'];
const STAGE_LABEL: Record<Stage, string> = { new: 'Новый', accepted: 'Принят', preparing: 'Готовится', ready: 'Готов' };
const STAGE_ICON = {
  new: IconStatusNew,
  accepted: IconStatusAccepted,
  preparing: IconStatusPreparing,
  ready: IconStatusReady,
} as const;

export interface OrderSample {
  number: number;
  room: string;
  venue: string;
  mode: string;
  stage: Stage;
  /** Минут до срока; отрицательное — просрочен на столько. */
  dueIn: number;
  dueAt: string;
  lines: string;
  total: string;
  assignee?: string;
}

export interface RoomSample {
  number: string;
  type: string;
  floor: string;
  guestIn: boolean;
  cleaned: boolean;
  controlOnline: boolean;
  temperature: number;
  openOrders: number;
}

function Photo({ src, alt }: { src?: string | null; alt: string }) {
  return <KitImage src={src ?? null} fit="fill" alt={alt} sizes="320px" fill />;
}

function Tile({ children, tone = 'info' }: { children: React.ReactNode; tone?: Tone }) {
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

const hhmm = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

export function venueCard(v: VenueSample, now = new Date()): EntityCardProps {
  const h = now.getHours();
  const open = v.closesAt < v.opensAt ? h >= v.opensAt || h < v.closesAt : h >= v.opensAt && h < v.closesAt;
  return {
    kind: 'Заведение',
    title: v.title,
    subtitle: `${v.kindLabel} · ${v.items} позиций`,
    banner: <Photo src={v.photo} alt={v.title} />,
    status: open
      ? { label: `Открыто до ${hhmm(v.closesAt)}`, tone: 'success' }
      : { label: `Откроется в ${hhmm(v.opensAt)}`, tone: 'warning' },
    facts: [
      {
        icon: <IconOrders />,
        text: `${v.inWork} в работе · ${v.overdue} просрочено`,
        tone: v.overdue > 0 ? 'error' : 'neutral',
      },
    ],
    primary: { label: 'Трекер точки' },
    testId: 'entity-card-venue',
  };
}

export function itemCard(i: ItemSample): EntityCardProps {
  return {
    kind: 'Позиция',
    title: i.title,
    subtitle: `${i.venue} · ${i.section}`,
    banner: <Photo src={i.photo} alt={i.title} />,
    status: i.inStock ? { label: 'В наличии', tone: 'success' } : { label: 'Стоп', tone: 'error' },
    hero: { text: i.price },
    facts: [{ text: `★ ${i.rating} · ${i.ordersWeek} заказов за неделю` }],
    primary: i.inStock ? { label: 'В стоп-лист', tone: 'danger' } : { label: 'Вернуть в продажу' },
    testId: 'entity-card-item',
  };
}

function StageScale({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <Box>
      <Stack direction="row" spacing={0.5} aria-label={`Этап: ${STAGE_LABEL[stage]}`}>
        {STAGES.map((s, index) => (
          <Box
            key={s}
            sx={(theme) => ({
              flex: 1,
              height: 6,
              borderRadius: 3,
              bgcolor:
                index <= at
                  ? theme.palette.primary.main
                  : alpha(theme.palette.text.primary, theme.palette.mode === 'light' ? 0.14 : 0.2),
            })}
          />
        ))}
      </Stack>
      <Stack direction="row" sx={{ mt: 0.5 }}>
        {STAGES.map((s, index) => (
          <Typography
            key={s}
            variant="caption"
            sx={{
              flex: 1,
              color: index === at ? 'text.primary' : 'text.secondary',
              fontWeight: index === at ? 700 : 400,
            }}
          >
            {STAGE_LABEL[s]}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function orderCard(o: OrderSample): EntityCardProps {
  const late = o.dueIn < 0;
  const StageIcon = STAGE_ICON[o.stage];
  return {
    kind: 'Заказ',
    title: `№ ${o.number} → номер ${o.room}`,
    subtitle: `${o.venue} · ${o.mode}`,
    tile: (
      <Tile tone={late ? 'error' : 'info'}>
        <IconOrders />
      </Tile>
    ),
    status: { label: STAGE_LABEL[o.stage], tone: late ? 'error' : 'warning', icon: <StageIcon /> },
    hero: late
      ? { text: `+${-o.dueIn} мин`, caption: `просрочен, срок был ${o.dueAt}`, tone: 'error' }
      : { text: `${o.dueIn} мин`, caption: `до срока ${o.dueAt}`, tone: o.dueIn <= 5 ? 'warning' : 'neutral' },
    extra: (
      <Stack spacing={1.25}>
        <StageScale stage={o.stage} />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ typography: 'body1', fontWeight: 500 }}>
          <IconRestaurant size={20} />
          <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{o.lines}</Box>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          {o.assignee ? (
            <>
              <Avatar sx={{ width: 28, height: 28, fontSize: 13, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                {initials(o.assignee)}
              </Avatar>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {o.assignee}
              </Typography>
            </>
          ) : (
            <Typography variant="body1" color="text.secondary">
              Не назначен
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Typography variant="body1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {o.total}
          </Typography>
        </Stack>
      </Stack>
    ),
    primary: { label: o.stage === 'ready' ? 'Выдан' : 'Готово' },
    openLabel: 'В трекере',
    testId: 'entity-card-order',
  };
}

function RoomSign({
  on,
  icon,
  label,
  tone = 'success',
}: {
  on: boolean;
  icon: React.ReactNode;
  label: string;
  tone?: Tone;
}) {
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

export function roomCard(r: RoomSample): EntityCardProps {
  return {
    kind: 'Номер',
    title: (
      <Box component="span" sx={{ typography: 'h3', fontWeight: 700, lineHeight: 1 }}>
        {r.number}
      </Box>
    ),
    subtitle: `${r.type} · ${r.floor}`,
    extra: (
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <RoomSign on={r.guestIn} icon={<IconBed />} label={r.guestIn ? 'Гость в номере' : 'Свободен'} />
        <RoomSign on={r.cleaned} icon={<IconMakeUpRoom />} label={r.cleaned ? 'Убран' : 'Не убран'} tone={r.cleaned ? 'success' : 'warning'} />
        <RoomSign on={r.controlOnline} icon={<IconWifi />} label={r.controlOnline ? 'На связи' : 'Нет связи'} tone={r.controlOnline ? 'success' : 'error'} />
        <RoomSign on icon={<IconThermostat />} label={`${r.temperature} °C`} tone="info" />
      </Stack>
    ),
    hero: {
      text: String(r.openOrders),
      caption: r.openOrders === 1 ? 'открытый заказ' : 'открытых заказа',
    },
    primary: { label: 'Заказ за гостя' },
    testId: 'entity-card-room',
  };
}

export { STAGE_LABEL };
