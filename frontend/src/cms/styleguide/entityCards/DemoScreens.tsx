import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { IconStaff } from '@/icons';

import { EntityName, type EntityCardProps } from './EntityCard';
import { STAGE_LABEL, itemCard, orderCard, roomCard, venueCard, type ItemSample, type OrderSample, type RoomSample, type VenueSample } from './cards';

/**
 * ПОКАЗ В ДЕЛЕ — макеты двух настоящих экранов с подчёркнутыми именами:
 * список заказов CMS (`cms/orders/OrdersPage.tsx`, строка — outlined-карточка)
 * и доска трекера (`tracker/components/OrderCard.tsx`, колонки по статусу).
 * Вёрстка повторяет рабочие экраны упрощённо; сами экраны не тронуты.
 */

export interface DemoData {
  venue: VenueSample;
  item: ItemSample;
  orders: OrderSample[];
  rooms: Record<string, RoomSample>;
}

function roomOf(data: DemoData, number: string): RoomSample {
  return (
    data.rooms[number] ?? {
      number,
      type: 'Стандарт',
      floor: `${number[0]} этаж`,
      guestIn: true,
      cleaned: true,
      controlOnline: true,
      temperature: 22,
      openOrders: 1,
    }
  );
}

function venueFor(data: DemoData, title: string): EntityCardProps {
  return venueCard({ ...data.venue, title });
}

/** Список заказов CMS: «№N · статус · заведение · номер» и сумма справа. */
export function DemoCmsOrders({ data }: { data: DemoData }) {
  return (
    <Box data-testid="demo-cms-orders">
      <Typography variant="h5" component="h3" sx={{ mb: 0.5 }}>
        Заказы
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Сегодня · все заведения
      </Typography>
      <Stack spacing={1}>
        {data.orders.map((o) => (
          <Card key={o.number} variant="outlined">
            <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle2" component="span">
                  <EntityName card={orderCard(o)} testId={`demo-cms-order-${o.number}`}>
                    №{o.number}
                  </EntityName>
                </Typography>
                <Chip size="small" label={STAGE_LABEL[o.stage]} />
                <Typography variant="body2" color="text.secondary" component="span">
                  <EntityName card={venueFor(data, o.venue)} testId={`demo-cms-venue-${o.number}`}>
                    {o.venue}
                  </EntityName>
                </Typography>
                <Typography variant="body2" color="text.secondary" component="span">
                  номер{' '}
                  <EntityName card={roomCard(roomOf(data, o.room))} testId={`demo-cms-room-${o.number}`}>
                    {o.room}
                  </EntityName>
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {o.total}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

const COLUMNS: { title: string; stages: OrderSample['stage'][] }[] = [
  { title: 'Новые', stages: ['new'] },
  { title: 'В работе', stages: ['accepted', 'preparing'] },
  { title: 'Готовы', stages: ['ready'] },
];

function BoardCard({ o, data }: { o: OrderSample; data: DemoData }) {
  const late = o.dueIn < 0;
  const firstItem = o.lines.split(' · ')[0] ?? o.lines;
  return (
    <Card variant="outlined" sx={{ borderColor: late ? 'error.main' : undefined }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} component="span">
            <EntityName card={orderCard(o)} testId={`demo-board-order-${o.number}`}>
              № {o.number}
            </EntityName>
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Chip
            size="small"
            variant="outlined"
            color={late ? 'error' : 'default'}
            label={late ? `+${-o.dueIn} мин` : `${o.dueIn} мин`}
          />
        </Stack>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Номер{' '}
          <EntityName card={roomCard(roomOf(data, o.room))} testId={`demo-board-room-${o.number}`}>
            {o.room}
          </EntityName>{' '}
          ·{' '}
          <EntityName card={venueFor(data, o.venue)} testId={`demo-board-venue-${o.number}`}>
            {o.venue}
          </EntityName>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          <EntityName card={itemCard({ ...data.item, title: firstItem.replace(/^\d+×\s*/, '') })} testId={`demo-board-item-${o.number}`}>
            {firstItem}
          </EntityName>
          {o.lines.includes(' · ') ? ` · ${o.lines.split(' · ').slice(1).join(' · ')}` : ''}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.75, color: 'text.secondary' }}>
          <IconStaff size={16} />
          <Typography variant="caption" color="text.secondary">
            {o.assignee ?? 'Не назначен'}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Доска трекера: три колонки, карточка заказа — номер, срок, «где», состав, исполнитель. */
export function DemoTrackerBoard({ data }: { data: DemoData }) {
  return (
    <Box data-testid="demo-tracker-board">
      <Typography variant="h5" component="h3" sx={{ mb: 1.5 }}>
        Трекер · {data.venue.title}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 1.5,
        }}
      >
        {COLUMNS.map((col) => {
          const cards = data.orders.filter((o) => col.stages.includes(o.stage));
          return (
            <Box key={col.title} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">{col.title}</Typography>
                <Chip size="small" label={cards.length} />
              </Stack>
              <Stack spacing={1}>
                {cards.map((o) => (
                  <BoardCard key={o.number} o={o} data={data} />
                ))}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
