import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';

import { OrderFieldValues } from '@/guest/components/OrderFieldValues';
import { OrderSlot } from '@/guest/components/OrderSlot';
import { OrderActions } from './OrderActions';
import { statusSlot } from '../statusColor';
import { itemsSummary, totalText, whenText, whereText } from '../orderText';
import { formatAge, formatClock, formatOverdue } from '../orderAge';
import { useTrackerLanguage } from '../hooks/useTrackerQueries';
import { useTrackerMoney } from '../hooks/useTrackerMoney';
import type { TrackerOrder } from '../api/types';
import { touchTarget } from '@/theme/density';

export interface OrderCardProps {
  order: TrackerOrder;
  busy: boolean;
  /** Перетаскивание доступно только на доске колонками — не в ленте записей. */
  draggable?: boolean;
  /** Just arrived / just changed — a calm ring, no animation circus. */
  highlighted?: boolean;
  errorText?: string | null;
  onOpen: () => void;
  onAccept: () => void;
  onStatus: (code: string) => void;
  onCancel: () => void;
}

export function OrderCard({
  order,
  busy,
  draggable = false,
  highlighted,
  errorText,
  onOpen,
  onAccept,
  onStatus,
  onCancel,
}: OrderCardProps) {
  const { t } = useTranslation();
  /*
    РУЧКА ЗАХВАТА ОТДЕЛЬНО ОТ ТАПА ПО КАРТОЧКЕ.

    Вся карточка — кнопка «открыть подробности», и повесить перетаскивание на
    неё же значит поссорить два жеста: палец на кухне попадает неточно и
    двигается, пока нажимает. Порог в пикселях эту разницу не ловит — жирный
    палец сдвигается на пять-шесть пикселей при обычном тапе, и половина
    открытий превращалась бы в микро-перетаскивания.

    Поэтому взяться можно только за ручку. Она широкая (44 px), стоит слева от
    номера и не перекрывает ничего читаемого.
  */
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: order.id,
    disabled: !draggable,
  });
  const language = useTrackerLanguage();
  const { format } = useTrackerMoney();
  const colorSlot = statusSlot(order.status.color_token);
  const fieldValues = order.field_values ?? [];
  const booking = order.slot ?? null;

  return (
    <Card
      ref={setNodeRef}
      variant="outlined"
      data-testid={`tracker-order-${order.number}`}
      sx={{
        borderColor: highlighted ? `${colorSlot}.main` : 'divider',
        borderWidth: highlighted ? 2 : 1,
        overflow: 'hidden',
        // Несомая карточка бледнеет НА МЕСТЕ, а не исчезает: пустое место под
        // пальцем читается как «уже переложил», и человек отпускает раньше.
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {busy ? <LinearProgress /> : null}

      <CardActionArea onClick={onOpen} sx={{ p: 1, pb: 0.75 }}>
        <Stack spacing={0.5}>
          <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
            {draggable ? (
              <Box
                component="span"
                ref={undefined}
                {...attributes}
                {...listeners}
                data-testid={`tracker-grip-${order.number}`}
                aria-label={t('tracker.card.grip')}
                // Тап по ручке НЕ должен открывать карточку: она лежит внутри
                // общей кнопки, и всплывший клик показал бы подробности сразу
                // после того, как заказ переложили.
                onClick={(event) => event.stopPropagation()}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  // Вид сжат, цель нажатия прежняя: 44px добирает прозрачный
                  // слой, а не сама ручка (см. `touchTarget`).
                  width: 24,
                  minHeight: 24,
                  ...touchTarget(),
                  ml: -0.5,
                  color: 'text.disabled',
                  cursor: 'grab',
                  touchAction: 'none',
                  '&:active': { cursor: 'grabbing' },
                }}
              >
                <DragIndicatorIcon sx={{ fontSize: 18 }} />
              </Box>
            ) : null}
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t('tracker.card.number', { number: order.number })}
            </Typography>
            <Chip size="small" label={order.status.title} color={colorSlot} variant="outlined" />
            <Box sx={{ flexGrow: 1 }} />
            {/*
              ЧАС КРУПНО, ВОЗРАСТ СЕРЫМ.

              Раньше здесь стоял один чип с сырыми минутами: «429 мин», а на
              стенде доходило до «89700 мин». Это два разных вопроса, и оба
              нужны. Заказ называют по времени приёма («тот, что в двадцать
              минут третьего»), а решение принимают по возрасту («висит два
              часа»). Одно число не отвечало ни на один из них.
            */}
            <Box sx={{ textAlign: 'end', minWidth: 0 }}>
              <Typography
                variant="subtitle2"
                sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
                data-testid={`tracker-clock-${order.number}`}
              >
                {formatClock(order.created_at, language)}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', lineHeight: 1.2 }}
                data-testid={`tracker-waiting-${order.number}`}
              >
                {formatAge(order.waiting_minutes, order.created_at, t, language)}
              </Typography>
            </Box>
          </Stack>

          {/*
            Просрочка называет ВЕЛИЧИНУ. Красный чип без числа одинаково
            выглядел у опоздавшего на минуту и у забытого на двое суток.
          */}
          {order.is_overdue ? (
            <Chip
              size="small"
              color="error"
              variant="filled"
              icon={<AccessTimeIcon sx={{ fontSize: 16 }} />}
              label={formatOverdue(order.overdue_minutes ?? 0, t)}
              data-testid={`tracker-overdue-${order.number}`}
              sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
            />
          ) : null}

          {/*
            A borrowed task says where it came from. The bartender is holding a
            sub-order with its own number, while the guest will quote the number
            of the order they actually placed — without this line the two never
            meet.
          */}
          {order.source_order ? (
            <Chip
              size="small"
              variant="outlined"
              color="info"
              icon={<CallSplitIcon sx={{ fontSize: 16 }} />}
              data-testid={`tracker-source-${order.number}`}
              label={t('tracker.card.fromOrder', {
                number: order.source_order.number,
                service: order.source_order.service_title,
              })}
              sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
            />
          ) : null}

          <Stack direction="row" spacing={0.5} alignItems="flex-start">
            <PlaceOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '2px' }} />
            <Typography variant="body2" sx={{ minWidth: 0 }}>
              {whereText(order, t)}
            </Typography>
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {whenText(order, t, language)}
          </Typography>

          {/*
            The ONLY difference a type makes on this board: the body of the
            card. Food shows its lines, a request shows the answers to its form,
            a booking shows the reserved slot. The choice is by the block that is
            present, never by the type string; columns, actions, statuses and the
            socket know nothing about it.
          */}
          {booking ? (
            <OrderSlot
              slot={booking}
              language={language}
              guestLabel={whereText(order, t)}
              testId="tracker-order-slot"
              dense
            />
          ) : fieldValues.length ? (
            <OrderFieldValues values={fieldValues} testId="tracker-order-fields" dense />
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {itemsSummary(order)}
            </Typography>
          )}

          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle2">{totalText(order, format)}</Typography>
            <Box sx={{ flexGrow: 1 }} />
            {order.assignee ? (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <PersonOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">
                  {order.assignee.name}
                </Typography>
              </Stack>
            ) : null}
          </Stack>
        </Stack>
      </CardActionArea>

      {errorText ? (
        <Box sx={{ px: 1, pb: 0.75 }}>
          <Alert severity="error" data-testid={`tracker-error-${order.number}`}>
            {errorText}
          </Alert>
        </Box>
      ) : null}

      <Divider />
      <Box sx={{ p: 1 }}>
        <OrderActions
          order={order}
          busy={busy}
          onAccept={onAccept}
          onStatus={onStatus}
          onCancel={onCancel}
        />
      </Box>
    </Card>
  );
}
