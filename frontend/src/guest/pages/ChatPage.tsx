import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { useTranslation } from 'react-i18next';

import { ChatConversation } from '@/components/chat/ChatConversation';
import { useChatLive } from '@/components/chat/useChatLive';
import { guestChatSocketUrl } from '../api/client';
import { markChatRead, sendChatMessage } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { errorMessage } from '../errors';
import { useGuestChat, useGuestLanguage } from '../hooks/useGuestQueries';
import { BOTTOM_NAV_HEIGHT } from '../layout/GuestLayout';
import type { ChatSnapshot } from '../api/types';

const HEADER_OFFSET = 56;

/**
 * Guest chat screen. The thread is reconciled by `useChatLive` (full snapshot in,
 * never a delta) and the message being typed lives in `useDraftState`, so neither
 * a refetch nor an incoming snapshot disturbs it. Staff messages are marked read
 * as soon as they are on screen, which clears the tab badge.
 */
export function ChatPage() {
  const { t } = useTranslation();
  const language = useGuestLanguage();
  const queryClient = useQueryClient();

  const { data: snapshot, isLoading, error } = useGuestChat();

  // The unread badge lives on the home payload — refresh it after each snapshot.
  const refreshBadge = () =>
    void queryClient.invalidateQueries({ queryKey: ['guest', 'home'], refetchType: 'active' });

  const live = useChatLive({
    url: guestChatSocketUrl(language),
    queryKey: guestKeys.chat,
    onSnapshot: refreshBadge,
  });

  const sendMutation = useMutation<ChatSnapshot, unknown, string>({
    mutationFn: (body) => sendChatMessage(body, language),
    onSuccess: (fresh) => {
      queryClient.setQueryData(guestKeys.chat, fresh);
      refreshBadge();
    },
  });

  // Mark staff messages read whenever the open thread has unread ones.
  const unread = snapshot?.unread ?? 0;
  useEffect(() => {
    if (unread <= 0) return;
    let cancelled = false;
    void markChatRead(language).then((fresh) => {
      if (cancelled) return;
      queryClient.setQueryData(guestKeys.chat, fresh);
      refreshBadge();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, language]);

  return (
    <Box
      sx={{
        height: `calc(100dvh - ${HEADER_OFFSET + BOTTOM_NAV_HEIGHT}px)`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {error && !snapshot ? (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">{errorMessage(error, t)}</Alert>
        </Box>
      ) : null}
      <ChatConversation
        snapshot={snapshot}
        live={live}
        loading={isLoading}
        sending={sendMutation.isPending}
        draftIdentity="guest-chat"
        emptyHint={t('guest.chat.emptyHint')}
        onSend={(body) => sendMutation.mutate(body)}
        testIds={{
          root: 'guest-chat',
          input: 'guest-chat-input',
          send: 'guest-chat-send',
          message: (id) => `guest-chat-message-${id}`,
        }}
      />
    </Box>
  );
}
