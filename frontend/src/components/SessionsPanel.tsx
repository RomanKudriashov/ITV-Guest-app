import { useTranslation } from 'react-i18next';

import { useActionFailed } from '@/hooks/useActionFailed';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { QueryState } from '@/components/QueryState';

export interface StaffSessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  ip: string | null;
  is_current: boolean;
}

/**
 * Страница входов. Текущая сессия — отдельным полем и всегда: по последней
 * активности она могла бы не попасть на страницу, а экран без «это вы» не с
 * чем сверить. `total` — все живые, кроме текущей.
 */
export interface SessionPage {
  current: StaffSessionRow | null;
  items: StaffSessionRow[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface SessionPageQuery {
  limit?: number;
  offset?: number;
}

/**
 * Мои сессии — один список на консоль платформы и на CMS отеля.
 *
 * Раз отзыв появился на сервере, человек обязан видеть, что именно он
 * отзывает: список входов, какой из них текущий, и кнопку закрыть. Иначе
 * «выйти везде» — это кнопка, действие которой не с чем сверить.
 *
 * Рисование общее, источник данных разный: каждая область передаёт свой
 * клиент. Второй такой же список рядом означал бы, что через полгода их будет
 * два с разным поведением.
 */
export function SessionsPanel({
  queryKey,
  fetchSessions,
  closeSession,
  logoutEverywhere,
  onLoggedOutEverywhere,
}: {
  queryKey: string[];
  fetchSessions: (page: SessionPageQuery) => Promise<SessionPage>;
  closeSession: (id: string) => Promise<unknown>;
  logoutEverywhere: () => Promise<unknown>;
  onLoggedOutEverywhere: () => void;
}) {
  const actionFailed = useActionFailed();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  // Страницами, «Показать ещё» дописывает следующую. Целиком список не
  // грузится никогда: у человека с долгой историей входов их сотни, а на
  // стенде у администратора было 7 936 — страница вытягивалась на 620 000 px.
  const sessions = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchSessions({ offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.offset + last.items.length : undefined),
  });

  const close = useMutation({
    mutationFn: closeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  
    // Отказ виден: молча съеденный 403 читается как успех.
    onError: actionFailed,
  });
  const everywhere = useMutation({
    mutationFn: logoutEverywhere,
    // Закрыли и текущую тоже — оставаться на экране незачем.
    onSuccess: onLoggedOutEverywhere,
  
    // Отказ виден: молча съеденный 403 читается как успех.
    onError: actionFailed,
  });

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.resolvedLanguage ?? 'ru', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  return (
    <Box data-testid="sessions-panel">
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {t('sessions.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('sessions.hint')}
      </Typography>

      <QueryState
        query={sessions}
        what={t('sessions.what')}
        isEmpty={(data) => !data.pages[0]?.current && (data.pages[0]?.total ?? 0) === 0}
        emptyText={t('sessions.empty')}
      >
        {(data) => {
          const first = data.pages[0];
          const rows = [
            ...(first?.current ? [first.current] : []),
            ...data.pages.flatMap((page) => page.items),
          ];
          const shown = rows.length - (first?.current ? 1 : 0);
          const total = first?.total ?? 0;
          return (
            <>
              <Stack divider={<Divider flexItem />} spacing={0}>
                {rows.map((row) => (
                  <SessionRow
                    key={row.id}
                    row={row}
                    when={when}
                    closing={close.isPending}
                    onClose={() => close.mutate(row.id)}
                  />
                ))}
              </Stack>
              {total > 0 ? (
                <Stack
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mt: 1 }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    data-testid="sessions-shown"
                  >
                    {t('sessions.shown', { shown, total })}
                  </Typography>
                  {sessions.hasNextPage ? (
                    <Button
                      size="small"
                      onClick={() => void sessions.fetchNextPage()}
                      disabled={sessions.isFetchingNextPage}
                      data-testid="sessions-more"
                    >
                      {t('sessions.more')}
                    </Button>
                  ) : null}
                </Stack>
              ) : null}
            </>
          );
        }}
      </QueryState>

      <Button
        variant="outlined"
        color="error"
        size="small"
        sx={{ mt: 2 }}
        disabled={everywhere.isPending}
        onClick={() => everywhere.mutate()}
        data-testid="sessions-logout-all"
      >
        {t('sessions.logoutAll')}
      </Button>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {t('sessions.logoutAllHint')}
      </Typography>
    </Box>
  );
}

function SessionRow({
  row,
  when,
  closing,
  onClose,
}: {
  row: StaffSessionRow;
  when: (iso: string) => string;
  closing: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={2}
      sx={{ py: 1.25 }}
      data-testid={`session-row${row.is_current ? '-current' : ''}`}
    >
      <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            {row.ip || t('sessions.unknownIp')}
          </Typography>
          {row.is_current ? (
            <Chip size="small" color="success" label={t('sessions.current')} />
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap>
          {t('sessions.entered', { when: when(row.created_at) })}
          {' · '}
          {t('sessions.seen', { when: when(row.last_seen_at) })}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {row.user_agent || t('sessions.unknownAgent')}
        </Typography>
      </Stack>
      {/*
        Текущую сессию закрывают кнопкой «Выйти» в шапке, а не отсюда:
        «закрыть» рядом с «это вы» читается как закрыть другую.
      */}
      {row.is_current ? null : (
        <Button
          size="small"
          color="error"
          disabled={closing}
          onClick={onClose}
          data-testid={`session-close-${row.id}`}
        >
          {t('sessions.close')}
        </Button>
      )}
    </Stack>
  );
}
