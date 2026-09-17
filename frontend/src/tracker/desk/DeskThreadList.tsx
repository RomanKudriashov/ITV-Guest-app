import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import type { TrackerChatThread } from '../api/types';

/**
 * Диалоги ресепшена. Порядок задаёт сервер: непрочитанные сверху, дальше по
 * последнему сообщению ГОСТЯ. Долго без ответа — красным; занятый коллегой —
 * с подписью «отвечает …».
 */
export function DeskThreadList({
  threads,
  loading,
  selected,
  myId,
  hasMore,
  loadingMore,
  onMore,
  onOpen,
}: {
  threads: TrackerChatThread[];
  loading: boolean;
  selected: string | null;
  myId: string | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();

  if (!loading && !threads.length) {
    return (
      <Box sx={{ pt: 4 }}>
        <EmptyState
          icon={<ChatBubbleOutlineIcon fontSize="large" />}
          title={t('tracker.chat.emptyTitle')}
          description={t('tracker.chat.emptyBody')}
        />
      </Box>
    );
  }

  return (
    <Stack divider={<Divider />} data-testid="desk-threads">
      {threads.map((thread) => {
        const late = Boolean(thread.is_late);
        const holder = thread.holder && thread.holder.id !== myId ? thread.holder : null;
        return (
          <ButtonBase
            key={thread.thread_id}
            onClick={() => onOpen(thread.thread_id)}
            data-testid={`desk-thread-${thread.thread_id}`}
            data-late={late ? 'true' : 'false'}
            sx={{
              px: 1.5,
              py: 1.25,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.25,
              textAlign: 'start',
              borderInlineStart: 3,
              borderColor: late ? 'error.main' : 'transparent',
              bgcolor: selected === thread.thread_id ? 'action.selected' : 'transparent',
            }}
          >
            <Badge color="error" badgeContent={thread.unread} max={99} sx={{ mt: 0.5 }}>
              <ChatBubbleOutlineIcon color={late ? 'error' : 'action'} />
            </Badge>
            <Stack sx={{ flexGrow: 1, minWidth: 0 }} spacing={0.25}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                  {thread.room ? t('tracker.chat.room', { room: thread.room }) : t('tracker.chat.noRoom')}
                </Typography>
                {thread.language ? (
                  <Typography variant="caption" color="text.secondary">
                    {thread.language.toUpperCase()}
                  </Typography>
                ) : null}
                {thread.last_guest_at || thread.last_at ? (
                  <Typography variant="caption" color="text.secondary">
                    {formatTime(thread.last_guest_at ?? thread.last_at ?? '', i18n.resolvedLanguage ?? 'en')}
                  </Typography>
                ) : null}
              </Stack>
              {thread.last_body ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {thread.last_body}
                </Typography>
              ) : null}
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {thread.waiting_minutes != null ? (
                  <Chip
                    size="small"
                    color={late ? 'error' : 'default'}
                    variant={late ? 'filled' : 'outlined'}
                    label={t('tracker.desk.waiting', { count: thread.waiting_minutes })}
                    data-testid={`desk-thread-waiting-${thread.thread_id}`}
                  />
                ) : null}
                {holder ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t('tracker.desk.answering', { name: holder.name })}
                    data-testid={`desk-thread-holder-${thread.thread_id}`}
                  />
                ) : null}
              </Stack>
            </Stack>
          </ButtonBase>
        );
      })}
      {hasMore ? (
        <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center' }}>
          <Button variant="outlined" size="small" disabled={loadingMore} onClick={onMore} data-testid="desk-more">
            {t('tracker.chat.more')}
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}

function formatTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(language, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short' }).format(date);
}
