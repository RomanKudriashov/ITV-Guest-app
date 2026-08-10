import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ChatConversation } from '@/components/chat/ChatConversation';
import { useChatLive } from '@/components/chat/useChatLive';
import { guestChatSocketUrl } from '../api/client';
import { markChatRead, sendChatMessage } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { errorMessage } from '../errors';
import { useGuestChat, useGuestLanguage } from '../hooks/useGuestQueries';
import { BOTTOM_NAV_SPACE } from '../layout/GuestLayout';
import { STICKY, useStickyLayer } from '../layout/stickyStack';
import { surfaceRadius } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
import type { ChatSnapshot } from '../api/types';

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
  const { glass, chatHint } = useStorefront();
  /*
    ЧАТ ПОДКЛЮЧЁН К ОБЩЕМУ СТЕКУ ЛИПКИХ СЛОЁВ.

    Здесь стояло `HEADER_OFFSET = 56` — число, взятое на глаз. Плавающая группа
    с номером и «⋯» висит поверх контента, и её реальная высота зависит от
    выреза, безопасной зоны и языка. Отсюда и перекрытое первое сообщение:
    экран начинался с нулевой отметки, а группа лежала поверх.

    Слоя своего чат не заводит — он только СПРАШИВАЕТ, сколько занято сверху.
    Заводить свой липкий слой здесь нельзя: это уже чинили дважды.
  */
  const shell = useStickyLayer<HTMLDivElement>(STICKY.plate);

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
        /*
          ВЫСОТА СЧИТАЕТСЯ ОДИН РАЗ, а не дважды.

          Раньше из высоты вычитались И шапка, И место под нижнее меню — при
          том, что место под меню УЖЕ зарезервировано отступом в раскладке
          (`main` держит `pb: BOTTOM_NAV_SPACE`). Замер на 390×844: строка ввода
          заканчивалась на 704, меню начиналось на 770 — шестьдесят шесть
          пикселей пустоты, ровно эта двойная арифметика.
        */
        pt: `${shell.top}px`,
        // Отступ сверху уже ВНУТРИ высоты: коробка считается по border-box, и
        // вычитать его второй раз значит укоротить экран на высоту шапки.
        height: `calc(100dvh - ${BOTTOM_NAV_SPACE}px)`,
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
        emptyState={
          <>
            <Typography variant="subtitle1" fontWeight={600} textAlign="center">
              {t('guest.chat.emptyTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {t('guest.chat.emptyHint')}
            </Typography>
          </>
        }
        // Карточка ввода — тот же рецепт, что у «Ваш номер» и погоды на
        // главной: стекло `panel` из словаря и общий радиус поверхностей.
        // Новой рецептуры не заводим — иначе низ чата снова станет чужой
        // деталью, как светлая полоса до этого.
        hintColor={chatHint}
        inputSurface={(theme) => ({
          background: glass.panel.background,
          backdropFilter: glass.panel.backdropFilter,
          WebkitBackdropFilter: glass.panel.backdropFilter,
          borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        })}
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
