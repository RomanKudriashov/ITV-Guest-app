import { useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import CheckIcon from '@mui/icons-material/Check';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';

import { statusSlot } from '../statusColor';
import type { TrackerOrder } from '../api/types';

export interface OrderActionsProps {
  order: TrackerOrder;
  /** True while any action of THIS order is in flight — buttons stay disabled. */
  busy: boolean;
  onAccept: () => void;
  onStatus: (code: string) => void;
  onCancel: () => void;
  size?: 'small' | 'medium';
}

/**
 * Действия по заказу: ОДНО главное и меню для остального.
 *
 * Раньше карточка показывала все переходы сразу — пять-шесть равнозначных
 * кнопок в ряд. На доске это давало стену: карточка вдвое выше нужного, а
 * повар в спешке читал четыре похожие надписи вместо того, чтобы нажать
 * очевидную. На телефоне доска становилась почти нечитаемой.
 *
 * Главное действие — то, которое сервер поставил ПЕРВЫМ в `next_statuses`
 * (или «принять», пока заказ не принят). Остальные переходы никуда не делись:
 * они нужны, когда надо перескочить или вернуть шаг назад, — но это
 * исправление, а не обычный ход, и его место в меню.
 *
 * Список переходов по-прежнему целиком с сервера: клиент не знает правил и не
 * переводит названия статусов.
 */
export function OrderActions({
  order,
  busy,
  onAccept,
  onStatus,
  onCancel,
  size = 'medium',
}: OrderActionsProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const canAccept = !order.accepted_at && !order.status.is_terminal;

  if (!canAccept && !order.next_statuses.length && !order.can_cancel) return null;

  // Пока заказ не принят, главное — принять его; дальше главным становится
  // следующий шаг потока. Всё, что осталось, уходит в меню.
  const [primaryStatus, ...restStatuses] = canAccept ? [] : order.next_statuses;
  const overflow = canAccept ? order.next_statuses : restStatuses;
  const hasOverflow = overflow.length > 0 || order.can_cancel;

  const close = () => setAnchor(null);
  const pick = (code: string) => {
    close();
    onStatus(code);
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
      {canAccept ? (
        <Button
          variant="contained"
          size={size}
          disabled={busy}
          startIcon={<CheckIcon />}
          onClick={onAccept}
          data-testid={`tracker-accept-${order.number}`}
          sx={{ minHeight: 44, flexGrow: 1 }}
        >
          {t('tracker.actions.accept')}
        </Button>
      ) : null}

      {primaryStatus ? (
        <Button
          variant="contained"
          size={size}
          color={statusSlot(primaryStatus.color_token)}
          disabled={busy}
          onClick={() => onStatus(primaryStatus.code)}
          data-testid={`tracker-status-${order.number}-${primaryStatus.code}`}
          sx={{ minHeight: 44, flexGrow: 1 }}
        >
          {primaryStatus.title}
        </Button>
      ) : null}

      {hasOverflow ? (
        <>
          <IconButton
            size={size}
            disabled={busy}
            onClick={(event) => setAnchor(event.currentTarget)}
            data-testid={`tracker-more-${order.number}`}
            aria-label={t('tracker.actions.more')}
            sx={{ minHeight: 44, minWidth: 44, flex: 'none' }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
            {overflow.map((next) => (
              <MenuItem
                key={next.code}
                onClick={() => pick(next.code)}
                data-testid={`tracker-status-${order.number}-${next.code}`}
              >
                {next.title}
              </MenuItem>
            ))}
            {order.can_cancel ? (
              <MenuItem
                onClick={() => {
                  close();
                  onCancel();
                }}
                data-testid={`tracker-cancel-${order.number}`}
                sx={{ color: 'error.main' }}
              >
                {t('tracker.actions.cancel')}
              </MenuItem>
            ) : null}
          </Menu>
        </>
      ) : null}
    </Stack>
  );
}
