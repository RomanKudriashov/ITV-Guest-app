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
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';

import { OrderFieldValues } from '@/guest/components/OrderFieldValues';
import { OrderSlot } from '@/guest/components/OrderSlot';
import { OrderActions } from './OrderActions';
import { statusSlot } from '../statusColor';
import { isPickup, itemsSummary, totalText, whenText, whereText } from '../orderText';
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
  /**
   * Переставить карточку на шаг вверх/вниз внутри своей колонки.
   *
   * Отдельным действием, а не шагом перетаскивания: `KeyboardSensor` применяет
   * заданную координату не целиком, и «шаг на соседа» превращался в ползание
   * (замер: из нужных 116 пикселей карточка уезжала на 40).
   */
  onReorder?: (direction: -1 | 1) => void;
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
  onReorder,
}: OrderCardProps) {
  const { t } = useTranslation();
  /*
    РУЧКА ЗАХВАТА ОТДЕЛЬНО ОТ ТАПА ПО КАРТОЧКЕ.

    Вся карточка — кнопка «открыть подробности», и повесить перетаскивание на
    неё же значит поссорить два жеста: палец на кухне попадает неточно и
    двигается, пока нажимает. Порог в пикселях эту разницу не ловит — жирный
    палец сдвигается на пять-шесть пикселей при обычном тапе, и половина
    открытий превращалась бы в микро-перетаскивания.

    ТЕПЕРЬ ТЯНЕТСЯ ВСЯ КАРТОЧКА, а различает тап и перенос не ручка, а ПОРОГ
    АКТИВАЦИИ, разный для мыши и пальца (см. сенсоры в `TrackerPage`):

      мышь  — восемь пикселей смещения. Дрожание руки на клике меньше, клик
              доходит до карточки и открывает подробности;
      палец — двести миллисекунд удержания с допуском в восемь пикселей.
              Тап короче, и тот самый жирный палец со смещением пять-шесть
              пикселей по-прежнему ОТКРЫВАЕТ карточку. Прокрутка доски уводит
              палец дальше допуска и отменяет захват — доска листается.

    Ручка осталась ПОДСКАЗКОЙ: она говорит «это можно таскать», но своих
    слушателей у неё больше нет — захват шире на всю карточку.
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
      // Просрочка в разметке, а не только в цвете: по ней колонка считает,
      // сколько просроченных осталось ниже экрана. Цвет глазом виден только
      // там, куда человек смотрит, — а сказать надо про то, куда он не смотрит.
      data-overdue={order.is_overdue ? 'true' : 'false'}
      // «Эту карточку сейчас несут». Состояние читается и глазом (пунктирный
      // контур ниже), и проверкой: подсветка мимолётна, а атрибут держится всё
      // время жеста. Срезан был по невнимательности при переносе обработчика
      // клавиш — вернулся на своё место.
      data-dragging={isDragging ? 'true' : 'false'}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      /*
        ALT+СТРЕЛКА ПЕРЕСТАВЛЯЕТ КАРТОЧКУ В ОЧЕРЕДИ.

        С модификатором, а не голой стрелкой: голые ↑/↓ прокручивают доску, и
        отнимать это у человека нельзя — он листает колонку постоянно, а
        переставляет изредка.

        СТОИТ ПОСЛЕ `listeners` И САМ ЗОВЁТ ИХ. У dnd-kit в `listeners` свой
        `onKeyDown` (им начинается захват пробелом), и объявленный ВЫШЕ спреда
        обработчик молча затирался — замерено: событие до карточки не доходило
        вовсе. Порядок здесь не стиль, а работоспособность обоих жестов.
      */
      onKeyDown={(event) => {
        if (draggable) listeners?.onKeyDown?.(event);
        if (event.defaultPrevented || !onReorder || !event.altKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onReorder(event.key === 'ArrowDown' ? 1 : -1);
      }}
      sx={{
        borderColor: highlighted ? `${colorSlot}.main` : 'divider',
        borderWidth: highlighted ? 2 : 1,
        overflow: 'hidden',
        /*
          РУКА НАД КАРТОЧКОЙ — обещание жеста до того, как за неё взялись.
          `manipulation`, а не `none`: с `none` браузер перестаёт прокручивать
          доску пальцем вовсе, а прокрутка здесь нужнее переноса.
        */
        cursor: draggable ? 'grab' : undefined,
        touchAction: draggable ? 'manipulation' : undefined,
        '&:active': draggable ? { cursor: 'grabbing' } : undefined,
        /*
          НА МЕСТЕ НЕСОМОЙ — СЕРЫЙ КОНТУР, А НЕ БЛЕДНАЯ КОПИЯ.

          Карточка уехала под курсор (`DragOverlay`), и оставлять здесь её
          полупрозрачный дубль значит показывать один заказ дважды. Контур
          говорит «отсюда взяли» и держит высоту — колонка не схлопывается.
        */
        ...(isDragging
          ? {
              '& > *': { visibility: 'hidden' },
              bgcolor: 'transparent',
              borderStyle: 'dashed',
              borderColor: 'text.disabled',
            }
          : null),
      }}
    >
      {busy ? <LinearProgress /> : null}

      <CardActionArea onClick={onOpen} sx={{ p: 1, pb: 0.75 }}>
        <Stack spacing={0.5}>
          <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
            {draggable ? (
              <Box
                component="span"
                data-testid={`tracker-grip-${order.number}`}
                aria-hidden
                // ПОДСКАЗКА, А НЕ ЗАХВАТ. Слушатели переехали на всю карточку;
                // здесь остался значок, который говорит «это можно таскать».
                // Клик по нему не должен открывать подробности дважды.
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

          {/*
            ПРИЗНАК ВЫДАЧИ — ДО МЕСТА. Иначе повар понесёт заказ туда, откуда
            за ним придут: «Комната 305» в начале строки читается как адрес.
          */}
          {isPickup(order) ? (
            <Chip
              size="small"
              color="secondary"
              icon={<StorefrontOutlinedIcon sx={{ fontSize: 16 }} />}
              label={t('tracker.card.pickup')}
              data-testid={`tracker-pickup-${order.number}`}
              sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
            />
          ) : null}
          <Stack direction="row" spacing={0.5} alignItems="flex-start">
            {isPickup(order) ? (
              <StorefrontOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '2px' }} />
            ) : (
              <PlaceOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '2px' }} />
            )}
            <Typography
              variant="body2"
              sx={{ minWidth: 0 }}
              data-testid={`tracker-where-${order.number}`}
            >
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
