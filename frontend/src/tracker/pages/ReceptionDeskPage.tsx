import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import Snackbar from '@mui/material/Snackbar';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/auth';
import { DeskConversation } from '../desk/DeskConversation';
import { DeskOrderDialog } from '../desk/DeskOrderDialog';
import { DeskGuestCardPanel } from '../desk/DeskGuestCardPanel';
import { DeskThreadList } from '../desk/DeskThreadList';
import { useTrackerChatThreads } from '../hooks/useTrackerQueries';

/**
 * РАБОЧЕЕ МЕСТО РЕСЕПШЕНА — три колонки: диалоги, переписка, карточка гостя.
 *
 * Сюда приходит ресепшен и администратор (`can_chat`); остальным — трекер.
 * Открытый диалог — в адресе (`?t=`): ссылку можно передать коллеге, F5 не
 * теряет место. На узком экране колонки идут по очереди.
 */
export function ReceptionDeskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get('t');
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('lg'));
  const [pane, setPane] = useState<'chat' | 'guest'>('chat');
  const [ordering, setOrdering] = useState(false);
  const [placed, setPlaced] = useState<number | null>(null);
  const canChat = Boolean(user?.can_chat);
  const threads = useTrackerChatThreads(canChat);

  if (user && !canChat) return <Navigate to="/tracker" replace />;

  const rows = threads.data?.pages.flatMap((page) => page.items) ?? [];
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('t', id);
    else next.delete('t');
    setParams(next, { replace: true });
    setPane('chat');
  };

  const list = (
    <DeskThreadList
      threads={rows}
      loading={threads.isLoading}
      selected={selected}
      myId={user?.id}
      hasMore={Boolean(threads.hasNextPage)}
      loadingMore={threads.isFetchingNextPage}
      onMore={() => void threads.fetchNextPage()}
      onOpen={open}
    />
  );
  const conversation = selected ? (
    <DeskConversation
      key={selected}
      threadId={selected}
      myId={user?.id}
      toolbar={
        <Button
          size="small"
          variant="contained"
          startIcon={<AddShoppingCartIcon />}
          onClick={() => setOrdering(true)}
          data-testid="desk-order-open"
        >
          {t('tracker.desk.order.open')}
        </Button>
      }
    />
  ) : (
    <Typography variant="body2" color="text.secondary" sx={{ p: 3 }}>
      {t('tracker.desk.pickDialog')}
    </Typography>
  );
  const card = <DeskGuestCardPanel threadId={selected} />;

  return (
    <>
      {selected ? (
        <DeskOrderDialog
          key={selected}
          threadId={selected}
          open={ordering}
          onClose={() => setOrdering(false)}
          onPlaced={(number) => {
            setOrdering(false);
            setPlaced(number);
          }}
        />
      ) : null}
      <Snackbar
        open={placed !== null}
        autoHideDuration={6000}
        onClose={() => setPlaced(null)}
        message={placed !== null ? t('tracker.desk.order.placed', { number: placed }) : ''}
        ContentProps={{ 'data-testid': 'desk-order-placed' } as never}
      />
      <Box
        data-testid="reception-desk"
        sx={{ height: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column' }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
          <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/tracker')}>
            {t('tracker.desk.toBoard')}
          </Button>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {t('tracker.desk.title')}
          </Typography>
        </Stack>
        {narrow ? (
          <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {!selected ? (
              <Box sx={{ overflowY: 'auto' }}>{list}</Box>
            ) : (
              <>
                <Stack direction="row" alignItems="center" sx={{ px: 1 }}>
                  <Button
                    size="small"
                    startIcon={<ArrowBackIcon />}
                    onClick={() => open(null)}
                    data-testid="desk-back"
                  >
                    {t('tracker.chat.back')}
                  </Button>
                  <Tabs value={pane} onChange={(_e, next) => setPane(next)} sx={{ ml: 'auto' }}>
                    <Tab value="chat" label={t('tracker.desk.chatTab')} />
                    <Tab
                      value="guest"
                      label={t('tracker.desk.guestTab')}
                      data-testid="desk-guest-tab"
                    />
                  </Tabs>
                </Stack>
                <Box
                  sx={{
                    flexGrow: 1,
                    minHeight: 0,
                    overflowY: pane === 'guest' ? 'auto' : 'hidden',
                  }}
                >
                  {pane === 'chat' ? conversation : card}
                </Box>
              </>
            )}
          </Box>
        ) : (
          <Box
            sx={{
              flexGrow: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: '320px minmax(0, 1fr) 340px',
              gap: 1,
              px: 1,
              pb: 1,
            }}
          >
            <Paper variant="outlined" sx={{ overflowY: 'auto' }}>
              {list}
            </Paper>
            <Paper variant="outlined" sx={{ minHeight: 0, overflow: 'hidden' }}>
              {conversation}
            </Paper>
            <Paper variant="outlined" sx={{ overflowY: 'auto' }}>
              {card}
            </Paper>
          </Box>
        )}
      </Box>
    </>
  );
}
