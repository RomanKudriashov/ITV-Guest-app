import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SendIcon from '@mui/icons-material/Send';
import { useTranslation } from 'react-i18next';

import { useDraftState } from '@/state/useDraftState';
import type { ChatMessage, ChatSnapshot } from '@/guest/api/types';
import type { LiveStatus } from './useChatLive';

export interface ChatTestIds {
  /** Root of the screen, e.g. `guest-chat` / `tracker-chat`. */
  root: string;
  input: string;
  send: string;
  /** `guest-chat-message-<id>`. */
  message: (id: string) => string;
}

export interface ChatConversationProps {
  snapshot: ChatSnapshot | undefined;
  live: LiveStatus;
  loading?: boolean;
  sending?: boolean;
  /** Re-seeds the draft when the thread changes (staff switches threads). */
  draftIdentity: string;
  emptyHint: string;
  onSend: (body: string) => void;
  testIds: ChatTestIds;
}

/**
 * One chat thread, shared verbatim by the guest and the staff sides. The bubbles
 * come from the reconciled snapshot in the query cache; the message being typed
 * lives in `useDraftState`, so a refetch or an incoming snapshot can never wipe
 * it. New messages auto-scroll to the bottom.
 */
export function ChatConversation({
  snapshot,
  live,
  loading,
  sending,
  draftIdentity,
  emptyHint,
  onSend,
  testIds,
}: ChatConversationProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft, resetDraft] = useDraftState<string>(() => '', draftIdentity);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const messages = snapshot?.messages ?? [];
  const count = messages.length;

  // Autoscroll to the newest bubble whenever the thread grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [count, draftIdentity]);

  const send = () => {
    const body = draft.trim();
    if (!body || sending) return;
    onSend(body);
    resetDraft();
  };

  return (
    <Box
      data-testid={testIds.root}
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      {live === 'offline' ? (
        <Stack alignItems="center" sx={{ py: 0.5 }}>
          <Chip
            size="small"
            variant="outlined"
            color="warning"
            icon={<CloudOffIcon sx={{ fontSize: 16 }} />}
            label={t('guest.chat.offline')}
            data-testid={`${testIds.root}-offline`}
          />
        </Stack>
      ) : null}

      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }}>
        {loading && !count ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress aria-label={t('guest.common.loading')} />
          </Stack>
        ) : !count ? (
          <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', px: 3 }}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {emptyHint}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1}>
            {messages.map((message) => (
              <Bubble
                key={message.id}
                message={message}
                language={i18n.resolvedLanguage ?? 'en'}
                testId={testIds.message(message.id)}
              />
            ))}
            <Box ref={bottomRef} />
          </Stack>
        )}
      </Box>

      <Stack
        direction="row"
        spacing={1}
        alignItems="flex-end"
        sx={{
          p: 1.5,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          value={draft}
          placeholder={t('guest.chat.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          inputProps={{
            'data-testid': testIds.input,
            'aria-label': t('guest.chat.placeholder'),
          }}
        />
        <IconButton
          color="primary"
          disabled={!draft.trim() || sending}
          onClick={send}
          data-testid={testIds.send}
          aria-label={t('guest.chat.send')}
          sx={{ minWidth: 44, minHeight: 44 }}
        >
          <SendIcon />
        </IconButton>
      </Stack>
    </Box>
  );
}

function Bubble({
  message,
  language,
  testId,
}: {
  message: ChatMessage;
  language: string;
  testId: string;
}) {
  const time = (() => {
    try {
      return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(message.created_at),
      );
    } catch {
      return '';
    }
  })();

  const mine = message.mine;

  return (
    <Stack
      data-testid={testId}
      sx={{ alignItems: mine ? 'flex-end' : 'flex-start', width: '100%' }}
    >
      <Box
        sx={(theme) => ({
          maxWidth: '82%',
          px: 1.5,
          py: 1,
          // Reference `.msg` — 15px radius with a 5px tail on the sender's side.
          borderRadius: '15px',
          ...(mine
            ? { borderBottomRightRadius: '5px' }
            : { borderBottomLeftRadius: '5px' }),
          border: mine ? 0 : 1,
          borderColor: 'divider',
          background: mine
            ? `linear-gradient(120deg, ${theme.palette.brand.primaryStrong}, ${theme.palette.primary.main})`
            : theme.palette.background.paper,
          color: mine ? theme.palette.primary.contrastText : theme.palette.text.primary,
        })}
      >
        {!mine ? (
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, opacity: 0.85 }}>
            {message.author_name}
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message.body}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, px: 0.5 }}>
        {time}
      </Typography>
    </Stack>
  );
}
