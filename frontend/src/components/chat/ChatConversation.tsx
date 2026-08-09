import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SendIcon from '@mui/icons-material/Send';
import { useTranslation } from 'react-i18next';

import { useDraftState } from '@/state/useDraftState';
import type { ChatMessage, ChatSnapshot } from '@/guest/api/types';
import type { SxProps, Theme } from '@mui/material/styles';

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
  /**
   * Внятное состояние пустого чата вместо голой строки: заголовок, подсказка,
   * может быть иконка. Не задано — остаётся `emptyHint` одной строкой.
   */
  emptyState?: ReactNode;
  /**
   * Поверхность строки ввода. Приходит СНАРУЖИ, а не берётся здесь: витрина
   * кладёт полосу на стекло из своего словаря, а трекер живёт вне гостевой
   * темы, и обратиться к её словарю отсюда нельзя.
   */
  inputSurface?: SxProps<Theme>;
  /**
   * Цвет подсказки в пустом поле. Приходит снаружи по той же причине, что и
   * поверхность: словарь витрины трекеру недоступен. Не задан — берём
   * `text.secondary`.
   */
  hintColor?: string;
  onSend: (body: string) => void;
  testIds: ChatTestIds;
}

/** Через сколько молчания сообщение начинает новую группу. */
const GROUP_GAP_MS = 5 * 60 * 1000;

interface Grouped {
  message: ChatMessage;
  /** Первое в группе — только у него подпись автора. */
  first: boolean;
  /** Последнее в группе — только у него время. */
  last: boolean;
  /** Новый день — перед ним разделитель. */
  dayStart: boolean;
}

function group(messages: ChatMessage[]): Grouped[] {
  const at = (message: ChatMessage) => new Date(message.created_at).getTime();
  const day = (message: ChatMessage) => new Date(message.created_at).toDateString();

  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const dayStart = !previous || day(previous) !== day(message);
    const sameSender = (a?: ChatMessage, b?: ChatMessage) =>
      Boolean(a && b) && a!.mine === b!.mine && a!.author_name === b!.author_name;
    return {
      message,
      dayStart,
      first: dayStart || !sameSender(previous, message) || at(message) - at(previous!) > GROUP_GAP_MS,
      last:
        !next ||
        day(next) !== day(message) ||
        !sameSender(message, next) ||
        at(next) - at(message) > GROUP_GAP_MS,
    };
  });
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
  emptyState,
  inputSurface,
  hintColor,
  onSend,
  testIds,
}: ChatConversationProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft, resetDraft] = useDraftState<string>(() => '', draftIdentity);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const messages = snapshot?.messages ?? [];
  const count = messages.length;
  const grouped = useMemo(() => group(messages), [messages]);

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
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={1}
            sx={{ height: '100%', px: 3 }}
            data-testid={`${testIds.root}-empty`}
          >
            {emptyState ?? (
              <Typography variant="body2" color="text.secondary" textAlign="center">
                {emptyHint}
              </Typography>
            )}
          </Stack>
        ) : (
          <Stack spacing={0.25}>
            {grouped.map((entry) => (
              <Box key={entry.message.id}>
                {entry.dayStart ? (
                  <DaySeparator
                    date={entry.message.created_at}
                    language={i18n.resolvedLanguage ?? 'en'}
                    testId={`${testIds.root}-day`}
                  />
                ) : null}
                <Bubble
                  message={entry.message}
                  language={i18n.resolvedLanguage ?? 'en'}
                  testId={testIds.message(entry.message.id)}
                  showAuthor={entry.first}
                  showTime={entry.last}
                />
              </Box>
            ))}
            <Box ref={bottomRef} />
          </Stack>
        )}
      </Box>

      {/*
        Строка ввода — та же пластика, что у поля «Номер» на экране входа:
        тонкая линия снизу вместо рамки. Рамка вокруг поля читалась заплатой
        поверх спокойного экрана, а линия отделяет ровно столько, сколько нужно.

        Поверхность приходит снаружи (`inputSurface`): витрина кладёт полосу на
        стекло из своего словаря, трекер оставляет её на бумаге панели.
      */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="flex-end"
        data-testid={`${testIds.root}-composer`}
        sx={[
          (theme: Theme) => ({
            px: 2,
            py: 1.25,
            // Полоса отделяется ЛИНИЕЙ, а не плашкой: на стекле поверх тёмной
            // ленты сама прозрачность почти не читается, и без линии строка
            // ввода сливается с перепиской.
            borderTop: `1px solid ${theme.palette.divider}`,
            // Безопасная зона учитывается ЗДЕСЬ: на телефоне с домашней полосой
            // поле иначе прижимается к самому краю.
            pb: 'calc(10px + env(safe-area-inset-bottom, 0px))',
          }),
          ...(Array.isArray(inputSurface) ? inputSurface : [inputSurface ?? {}]),
        ]}
      >
        <Box
          sx={(theme) => ({
            flexGrow: 1,
            display: 'flex',
            alignItems: 'flex-end',
            position: 'relative',
            borderBottom: `1px solid ${theme.palette.divider}`,
            pb: 0.5,
            transition: 'border-color .25s',
            '&:focus-within': { borderColor: theme.palette.primary.main },
          })}
        >
          {/*
            ПОДСКАЗКА РИСУЕТСЯ САМА, а не отдаётся `placeholder`.

            Родной placeholder MUI — это цвет текста с опорной прозрачностью,
            и на светлой теме он давал контраст 2.58 при пороге AA 4.5.
            Перекрасить его через `sx` нельзя: правило `::placeholder` в
            рантайме роняет префиксер stylis (тот же шрам записан в поле
            «Номер» на экране входа). Поэтому — своя строка поверх пустого
            поля, цвет из темы.
          */}
          {!draft ? (
            <Typography
              aria-hidden
              variant="body2"
              sx={{
                position: 'absolute',
                pointerEvents: 'none',
                color: hintColor ?? 'text.secondary',
                fontSize: 15,
              }}
            >
              {t('guest.chat.placeholder')}
            </Typography>
          ) : null}
          <InputBase
            fullWidth
            multiline
            // Три строки: дальше поле начинает съедать переписку, ради которой
            // экран и открыт, — и прокручивается внутри себя.
            maxRows={3}
            value={draft}
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
              // По той же причине, что и в пузыре: пишут не обязательно на
              // языке интерфейса.
              dir: 'auto',
            }}
            sx={{ fontSize: 15 }}
          />
        </Box>
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

/**
 * Спокойный разделитель дней: дата читается один раз и не спорит с перепиской.
 */
function DaySeparator({
  date,
  language,
  testId,
}: {
  date: string;
  language: string;
  testId: string;
}) {
  const label = (() => {
    try {
      const value = new Date(date);
      const today = new Date();
      const sameDay = value.toDateString() === today.toDateString();
      if (sameDay) return null;
      return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(value);
    } catch {
      return null;
    }
  })();

  return (
    <Stack alignItems="center" sx={{ py: 1 }} data-testid={testId}>
      <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.75 }}>
        {label ?? ''}
      </Typography>
    </Stack>
  );
}

function Bubble({
  message,
  language,
  testId,
  showAuthor,
  showTime,
}: {
  message: ChatMessage;
  language: string;
  testId: string;
  showAuthor: boolean;
  showTime: boolean;
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
      sx={{ alignItems: mine ? 'flex-end' : 'flex-start', width: '100%', mt: showAuthor ? 0.75 : 0.25 }}
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
        {/* Имя — ОДИН РАЗ на группу: повтор в каждом пузыре превращает
            переписку в список карточек. */}
        {!mine && showAuthor ? (
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, opacity: 0.85 }}>
            {message.author_name}
          </Typography>
        ) : null}
        {/* Направление — ПО СОДЕРЖИМОМУ сообщения, а не по языку интерфейса.
            Гость с арабским интерфейсом пишет и получает сообщения на разных
            языках, и латиница внутри RTL-абзаца ломается на знаках препинания:
            «Здравствуйте!» показывается как «!Здравствуйте». */}
        <Typography
          variant="body2"
          dir="auto"
          sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {message.body}
        </Typography>
      </Box>
      {/* Время — у последнего в группе: у каждого оно дробит ленту. */}
      {showTime ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, px: 0.5 }}>
          {time}
        </Typography>
      ) : null}
    </Stack>
  );
}
