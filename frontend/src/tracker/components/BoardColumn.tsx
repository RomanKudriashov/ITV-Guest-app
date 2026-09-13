import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';

import { OverdueBelow } from './OverdueBelow';
import type { TrackerColumn, TrackerRoomGroup } from '../api/types';

export interface BoardColumnProps {
  column: TrackerColumn;
  /** Column header is redundant on the phone — the tab already says it. */
  showHeader?: boolean;
  /**
   * Несут ли сейчас карточку — и можно ли бросить СЮДА.
   *
   * `null` — покой, колонка выглядит обычно. `true` — цель допустима.
   * `false` — сюда нельзя, и это видно В МОМЕНТ ЗАХВАТА: переходы идут только
   * вперёд, блюдо нельзя разготовить. Красный отказ после броска был бы нашей
   * ошибкой, а не ошибкой повара.
   */
  dropAllowed?: boolean | null;
  /**
   * Куда ляжет несомая карточка — индекс среди карточек колонки.
   *
   * `null` — зазора нет: либо жеста нет, либо цель не эта колонка. Индекс
   * считает страница по тому же правилу, по которому кладёт сервер (время
   * создания), а не по месту курсора: ручного порядка у заказа нет, и выбор
   * позиции обещать нечем.
   */
  placeholderAt?: number | null;
  /**
   * Заявки по комнатам. Когда группы есть, карточки рисуются внутри них —
   * заголовок группы называет комнату, и горничная видит поход целиком.
   */
  renderGroup?: (group: TrackerRoomGroup) => ReactNode;
  children: ReactNode;
}

export function BoardColumn({
  column,
  showHeader = true,
  dropAllowed = null,
  placeholderAt = null,
  renderGroup,
  children,
}: BoardColumnProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.code}`,
    disabled: dropAllowed === false,
  });

  return (
    <Stack
      ref={setNodeRef}
      spacing={1.25}
      data-testid={`tracker-column-${column.code}`}
      // Состояние цели читается и тестом, и глазом: подсветка мимолётна, а
      // атрибут остаётся на всё время жеста.
      data-drop={dropAllowed === null ? 'idle' : dropAllowed ? 'allowed' : 'forbidden'}
      sx={(theme) => ({
        minWidth: 0,
        flex: showHeader ? '1 1 0' : undefined,
        borderRadius: 2,
        p: dropAllowed === null ? 0 : 0.75,
        transition: 'background-color .12s, outline-color .12s',
        outline: dropAllowed === null ? 'none' : '2px dashed',
        outlineColor:
          dropAllowed === false
            ? alpha(theme.palette.text.disabled, 0.5)
            : isOver
              ? theme.palette.primary.main
              : alpha(theme.palette.primary.main, 0.4),
        bgcolor:
          dropAllowed && isOver ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        // Запрещённая колонка ГАСНЕТ, а не краснеет: красный — это «случилась
        // беда», а здесь просто «не сюда».
        opacity: dropAllowed === false ? 0.45 : 1,
      })}
    >
      {showHeader ? (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5 }}>
          <Typography variant="subtitle2">{column.title}</Typography>
          <Chip size="small" label={column.orders.length} />
        </Stack>
      ) : null}

      {column.orders.length || placeholderAt !== null ? (
        column.groups && renderGroup ? (
          <Stack spacing={1.75}>{column.groups.map(renderGroup)}</Stack>
        ) : (
          <Stack spacing={1.25}>{withPlaceholder(children, placeholderAt, t)}</Stack>
        )
      ) : (
        <Box
          sx={{
            py: 3,
            px: 2,
            textAlign: 'center',
            borderRadius: 2,
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {t('tracker.board.emptyColumn')}
          </Typography>
        </Box>
      )}

      {/*
        Отодвинутое вниз просроченное не поднимается само — но и не молчит.
        Подпись `sticky`, поэтому висит у нижнего края колонки, а не уезжает
        вместе с содержимым, о котором говорит.
      */}
      <OverdueBelow
        columnCode={column.code}
        signature={column.orders.map((order) => `${order.id}:${order.is_overdue}`).join(',')}
      />
    </Stack>
  );
}

/**
 * Зазор между карточками — место, куда ляжет несомая.
 *
 * Раздвигается именно ТА щель, в которую карточка встанет: колонка
 * сортируется по времени создания, и место известно заранее. Показывать щель
 * под курсором значило бы обещать выбор позиции, которого у продукта нет.
 */
function withPlaceholder(
  children: ReactNode,
  at: number | null,
  t: ReturnType<typeof useTranslation>['t'],
): ReactNode {
  if (at === null) return children;
  const cards = Array.isArray(children) ? [...children] : [children];
  const gap = (
    <Box
      key="tracker-drop-placeholder"
      data-testid="tracker-drop-placeholder"
      aria-label={t('tracker.board.dropHere')}
      sx={{
        height: 56,
        borderRadius: 2,
        border: 2,
        borderStyle: 'dashed',
        borderColor: 'primary.main',
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.06),
      }}
    />
  );
  const index = Math.max(0, Math.min(at, cards.length));
  return [...cards.slice(0, index), gap, ...cards.slice(index)];
}
