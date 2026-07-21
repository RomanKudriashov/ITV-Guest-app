import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import type { TrackerColumn } from '../api/types';

export interface BoardColumnProps {
  column: TrackerColumn;
  /** Column header is redundant on the phone — the tab already says it. */
  showHeader?: boolean;
  children: ReactNode;
}

export function BoardColumn({ column, showHeader = true, children }: BoardColumnProps) {
  const { t } = useTranslation();

  return (
    <Stack
      spacing={1.25}
      data-testid={`tracker-column-${column.code}`}
      sx={{ minWidth: 0, flex: showHeader ? '1 1 0' : undefined }}
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
