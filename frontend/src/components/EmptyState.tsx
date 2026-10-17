import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  testId?: string;
  /**
   * Подложка под текстом (партия 58б): витрина кладёт сюда подложку цветом
   * страницы, когда за пустым состоянием — фото фона бренда без вуали.
   */
  plateSx?: SxProps<Theme>;
}

export function EmptyState({ title, description, action, icon, testId, plateSx }: EmptyStateProps) {
  return (
    <Stack
      spacing={1}
      alignItems="center"
      justifyContent="center"
      data-testid={testId}
      sx={{ py: 6, px: 3, textAlign: 'center', color: 'text.secondary' }}
    >
      <Stack
        spacing={1}
        alignItems="center"
        data-plate={plateSx ? '' : undefined}
        sx={[{ px: 2, py: 1.5 }, ...(Array.isArray(plateSx) ? plateSx : [plateSx])]}
      >
        <Box sx={{ opacity: 0.6 }}>{icon ?? <InboxOutlinedIcon fontSize="large" />}</Box>
        <Typography variant="subtitle1" color="text.primary">
          {title}
        </Typography>
        {description ? <Typography variant="body2">{description}</Typography> : null}
        {action ? <Box sx={{ pt: 1 }}>{action}</Box> : null}
      </Stack>
    </Stack>
  );
}
