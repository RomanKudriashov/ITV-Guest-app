import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';

import type { TrackerColumn } from '../api/types';

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
  children: ReactNode;
}

export function BoardColumn({
  column,
  showHeader = true,
  dropAllowed = null,
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

      {column.orders.length ? (
        <Stack spacing={1.25}>{children}</Stack>
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
    </Stack>
  );
}
