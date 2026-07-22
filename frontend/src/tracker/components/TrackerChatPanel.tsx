import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useTranslation } from 'react-i18next';

import { ChatConversation } from '@/components/chat/ChatConversation';
import { useChatLive } from '@/components/chat/useChatLive';
import { EmptyState } from '@/components/EmptyState';
import { markChatThreadRead, sendChatReply, staffChatSocketUrl } from '../api/tracker';
import { trackerKeys } from '../api/queryKeys';
import {
  useTrackerChatThread,
  useTrackerChatThreads,
  useTrackerLanguage,
} from '../hooks/useTrackerQueries';
import type { TrackerChatSnapshot, TrackerChatThread } from '../api/types';

export interface TrackerChatPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Staff chat, a side panel over the board. The thread list and the open
 * conversation reuse the very same `ChatConversation`/`useChatLive` the guest
 * uses — only the WS URL (`ws/staff/chat/{id}/`) and the query keys differ.
 */
export function TrackerChatPanel({ open, onClose }: TrackerChatPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const threadsQuery = useTrackerChatThreads(open);
  const threads = threadsQuery.data ?? [];

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 420 },
          maxWidth: '100%',
          bgcolor: 'background.paper',
        },
      }}
    >
      <Box
        data-testid="tracker-chat"
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {activeId ? (
          <ThreadView
            threadId={activeId}
            onBack={() => setActiveId(null)}
            onClose={onClose}
          />
        ) : (
          <ThreadList
            threads={threads}
            loading={threadsQuery.isLoading}
            onOpen={setActiveId}
            onClose={onClose}
          />
        )}
      </Box>
    </Drawer>
  );
}

function ThreadList({
  threads,
  loading,
  onOpen,
  onClose,
}: {
  threads: TrackerChatThread[];
  loading: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();

  return (
    <>
      <Header title={t('tracker.chat.title')} onClose={onClose} />
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
        {!loading && !threads.length ? (
          <Box sx={{ pt: 4 }}>
            <EmptyState
              icon={<ChatBubbleOutlineIcon fontSize="large" />}
              title={t('tracker.chat.emptyTitle')}
              description={t('tracker.chat.emptyBody')}
            />
          </Box>
        ) : (
          <Stack divider={<Divider />}>
            {threads.map((thread) => (
              <ButtonBase
                key={thread.thread_id}
                onClick={() => onOpen(thread.thread_id)}
                data-testid={`tracker-chat-thread-${thread.thread_id}`}
                sx={{
                  px: 2,
                  py: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  textAlign: 'start',
                  minHeight: 64,
                }}
              >
                <Badge color="error" badgeContent={thread.unread} max={99}>
                  <ChatBubbleOutlineIcon color="action" />
                </Badge>
                <Stack sx={{ flexGrow: 1, minWidth: 0 }} spacing={0.25}>
                  <Typography variant="subtitle2">
                    {thread.room
                      ? t('tracker.chat.room', { room: thread.room })
                      : t('tracker.chat.noRoom')}
                  </Typography>
                  {thread.last_body ? (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {thread.last_body}
                    </Typography>
                  ) : null}
                </Stack>
                {thread.last_at ? (
                  <Typography variant="caption" color="text.secondary">
                    {formatTime(thread.last_at, i18n.resolvedLanguage ?? 'en')}
                  </Typography>
                ) : null}
              </ButtonBase>
            ))}
          </Stack>
        )}
      </Box>
    </>
  );
}

function ThreadView({
  threadId,
  onBack,
  onClose,
}: {
  threadId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const language = useTrackerLanguage();
  const queryClient = useQueryClient();

  const { data: snapshot, isLoading } = useTrackerChatThread(threadId);

  const refreshThreads = () =>
    void queryClient.invalidateQueries({
      queryKey: ['tracker', 'chat', 'threads'],
      refetchType: 'active',
    });

  const live = useChatLive({
    url: staffChatSocketUrl(threadId, language),
    queryKey: trackerKeys.chatThread(threadId),
    onSnapshot: refreshThreads,
  });

  const sendMutation = useMutation<TrackerChatSnapshot, unknown, string>({
    mutationFn: (body) => sendChatReply(threadId, body, language),
    onSuccess: (fresh) => {
      queryClient.setQueryData(trackerKeys.chatThread(threadId), fresh);
      refreshThreads();
    },
  });

  const unread = snapshot?.unread ?? 0;
  useEffect(() => {
    if (unread <= 0) return;
    let cancelled = false;
    void markChatThreadRead(threadId, language).then((fresh) => {
      if (cancelled) return;
      queryClient.setQueryData(trackerKeys.chatThread(threadId), fresh);
      refreshThreads();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, threadId, language]);

  const room = snapshot?.room ?? null;

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <IconButton onClick={onBack} aria-label={t('tracker.chat.back')} sx={{ minWidth: 44, minHeight: 44 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          {room ? t('tracker.chat.room', { room }) : t('tracker.chat.noRoom')}
        </Typography>
        <IconButton onClick={onClose} aria-label={t('tracker.detail.close')} sx={{ minWidth: 44, minHeight: 44 }}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <ChatConversation
          snapshot={snapshot}
          live={live}
          loading={isLoading}
          sending={sendMutation.isPending}
          draftIdentity={threadId}
          emptyHint={t('tracker.chat.emptyThread')}
          onSend={(body) => sendMutation.mutate(body)}
          testIds={{
            root: 'tracker-chat-conversation',
            input: 'tracker-chat-input',
            send: 'tracker-chat-send',
            message: (id) => `tracker-chat-message-${id}`,
          }}
        />
      </Box>
    </>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Typography variant="h6" sx={{ flexGrow: 1 }}>
        {title}
      </Typography>
      <IconButton onClick={onClose} aria-label={t('tracker.detail.close')} sx={{ minWidth: 44, minHeight: 44 }}>
        <CloseIcon />
      </IconButton>
    </Stack>
  );
}

function formatTime(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return '';
  }
}
