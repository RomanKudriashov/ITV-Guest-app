import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ChatConversation } from '@/components/chat/ChatConversation';
import { useChatLive } from '@/components/chat/useChatLive';
import {
  markChatThreadRead,
  releaseChatThread,
  sendChatReply,
  staffChatSocketUrl,
  takeChatThread,
} from '../api/tracker';
import { trackerKeys } from '../api/queryKeys';
import { useTrackerChatThread, useTrackerLanguage } from '../hooks/useTrackerQueries';
import type { TrackerChatSnapshot } from '../api/types';

const RELEASE_DELAY_MS = 500;
const pendingRelease = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Переписка на рабочем месте. Открыть диалог — взять его (если свободен);
 * уйти к другому или закрыть место — отпустить. Занятый коллегой диалог
 * открывается и отвечается, но сверху видно «отвечает Дарья».
 *
 * Шапка — «Ресепшен · номер 305»: гостю отвечает отдел, и имя сотрудника
 * гость не видит (сервер подписывает ответы названием отдела).
 */
export function DeskConversation({
  threadId,
  myId,
  toolbar,
}: {
  threadId: string;
  myId: string | undefined;
  /** Действия над диалогом: «Оформить заказ» и прочее (шаг 7). */
  toolbar?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const language = useTrackerLanguage();
  const queryClient = useQueryClient();
  const { data: snapshot, isLoading } = useTrackerChatThread(threadId, true);
  const key = trackerKeys.chatThread(threadId);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ['tracker', 'chat', 'threads'],
      refetchType: 'active',
    });
    void queryClient.invalidateQueries({ queryKey: ['tracker', 'chat', 'guest', threadId] });
  };

  const live = useChatLive({
    url: staffChatSocketUrl(threadId, language),
    queryKey: key,
    onSnapshot: refresh,
  });

  // Ушёл к другому диалогу или закрыл место — отпустить свой.
  //
  // С ЗАДЕРЖКОЙ, А НЕ СРАЗУ. React в разработке монтирует экран дважды:
  // мгновенное «отпустить» в очистке уходило сразу за «взять» и снимало
  // только что взятый диалог. Повторный монтаж того же диалога отменяет
  // отложенное освобождение.
  useEffect(() => {
    const pending = pendingRelease.get(threadId);
    if (pending) {
      clearTimeout(pending);
      pendingRelease.delete(threadId);
    }
    return () => {
      const timer = setTimeout(() => {
        pendingRelease.delete(threadId);
        void releaseChatThread(threadId)
          .then(() => refresh())
          .catch(() => undefined);
      }, RELEASE_DELAY_MS);
      pendingRelease.set(threadId, timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const send = useMutation<TrackerChatSnapshot, unknown, string>({
    mutationFn: (body) => sendChatReply(threadId, body, language),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      refresh();
    },
  });

  const take = useMutation<TrackerChatSnapshot>({
    mutationFn: () => takeChatThread(threadId, language),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      refresh();
    },
  });

  const unread = snapshot?.unread ?? 0;
  useEffect(() => {
    if (unread <= 0) return;
    let cancelled = false;
    void markChatThreadRead(threadId, language).then((fresh) => {
      if (cancelled) return;
      queryClient.setQueryData(key, fresh);
      refresh();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, threadId, language]);

  const holder = snapshot?.holder ?? null;
  const someoneElse = holder && holder.id !== myId ? holder : null;
  const room = snapshot?.room ?? null;

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }} data-testid="desk-conversation">
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }} data-testid="desk-conversation-title">
          {snapshot?.counterpart ?? t('tracker.desk.reception')}
          {room ? ` · ${t('tracker.chat.room', { room })}` : ''}
        </Typography>
        {toolbar}
      </Stack>
      {someoneElse ? (
        <Alert
          severity="info"
          sx={{ borderRadius: 0 }}
          data-testid="desk-holder-banner"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => take.mutate()}
              data-testid="desk-take"
            >
              {t('tracker.desk.takeOver')}
            </Button>
          }
        >
          {t('tracker.desk.answering', { name: someoneElse.name })}
        </Alert>
      ) : null}
      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <ChatConversation
          snapshot={snapshot}
          live={live}
          loading={isLoading}
          sending={send.isPending}
          draftIdentity={threadId}
          emptyHint={t('tracker.chat.emptyThread')}
          onSend={(body) => send.mutate(body)}
          testIds={{
            root: 'tracker-chat-conversation',
            input: 'tracker-chat-input',
            send: 'tracker-chat-send',
            message: (id) => `tracker-chat-message-${id}`,
          }}
        />
      </Box>
    </Stack>
  );
}
