import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, panelSx, pillSx, surface, typo } from '../adminTokens';
import { QueryState } from '@/components/QueryState';
import { ListEmpty } from '@/kit/list/ListEmpty';
import { useListQuery } from '@/kit/list/useListQuery';
import { getImpersonations, revokeImpersonation, type ImpersonationRow } from '../adminClient';

/**
 * Активные входы под аудитом — и кнопка оборвать.
 *
 * Раздел существует потому, что «войти в отель» было действием без обратного
 * хода: грант создавался, токен подписывался, и дальше сессия жила сама по
 * себе до истечения срока. Отозвать её было нечем — не «неудобно», а нечем.
 *
 * Список показывает ровно живые сессии: отозванная или истёкшая исчезает.
 * Пустой список — это утверждение «сейчас в отелях никого нет», и ради него
 * пустое состояние подписано словами, а не оставлено пустым местом.
 */
export function SupportSessionsPage({ hotelId }: { hotelId?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  /*
    Активные И ЗАВЕРШЁННЫЕ. Раньше выдача была только «кто внутри сейчас», и
    разбор инцидента упирался в стену: кто заходил вчера, узнать было негде,
    хотя записи никуда не делись.
  */
  const { params, patch, reset, isFiltered } = useListQuery({ state: 'active', search: '' });
  const sessions = useQuery({
    queryKey: ['admin', 'impersonations', params.state, params.search],
    queryFn: () =>
      getImpersonations({
        state: params.state as 'active' | 'history' | 'all',
        search: params.search,
      }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeImpersonation(id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'impersonations'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.support.revokeFailed')),
  });

  // В карточке отеля показываем только его сессии: там вопрос «кто сейчас у
  // МЕНЯ», а не «кто сейчас вообще».
  const mine = (page: { items: ImpersonationRow[] }) =>
    hotelId ? page.items.filter((row) => row.hotel_id === hotelId) : page.items;

  return (
    <Box data-testid="admin-support-sessions">
      {hotelId ? null : (
        <>
          <Typography sx={{ ...typo.pageTitle, color: ink.hi }}>
            {t('admin.support.title')}
          </Typography>
          <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>
            {t('admin.support.subtitle')}
          </Typography>
        </>
      )}

      {error ? (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {/* Активные / история / все — и поиск. Всё в адресе: ссылкой на разбор
          можно поделиться, и она откроется той же выборкой. */}
      {hotelId ? null : (
        <Box sx={{ ...panelSx, mt: 2, display: 'flex', gap: 1.5, alignItems: 'center' }}>
          {(['active', 'history', 'all'] as const).map((state) => (
            <ButtonBase
              key={state}
              onClick={() => patch({ state })}
              data-testid={`admin-support-state-${state}`}
              data-active={params.state === state ? 'true' : undefined}
              sx={{
                px: 1.5,
                py: 0.75,
                borderRadius: 1,
                ...typo.caption,
                fontWeight: 600,
                border: `1px solid ${params.state === state ? accent.main : surface.line}`,
                color: params.state === state ? accent.soft : ink.mid,
              }}
            >
              {t(`admin.support.state.${state}`)}
            </ButtonBase>
          ))}
          <TextField
            size="small"
            value={params.search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => patch({ search: event.target.value })}
            placeholder={t('list.searchPlaceholder')}
            inputProps={{ 'data-testid': 'admin-support-search' }}
            sx={{ minWidth: 200 }}
          />
          <Box sx={{ flexGrow: 1 }} />
          {sessions.data ? (
            <Typography sx={{ color: ink.low, ...typo.caption }} data-testid="admin-support-total">
              {t('list.ofTotal', {
                shown: sessions.data.items.length,
                total: sessions.data.total,
              })}
            </Typography>
          ) : null}
        </Box>
      )}

      <QueryState query={sessions} what={t('state.what.support')}>
        {(page) =>
          mine(page).length === 0 ? (
            <ListEmpty
              isFiltered={isFiltered}
              onReset={reset}
              what={t('state.what.support')}
            />
          ) : (
          <Box sx={{ ...panelSx, mt: hotelId ? 0 : 2.25 }}>
            {mine(page).map((row) => (
              <SessionRow
                key={row.id}
                row={row}
                showHotel={!hotelId}
                busy={revoke.isPending}
                onRevoke={() => revoke.mutate(row.id)}
              />
            ))}
          </Box>
          )
        }
      </QueryState>
    </Box>
  );
}

function SessionRow({
  row,
  showHotel,
  busy,
  onRevoke,
}: {
  row: ImpersonationRow;
  showHotel: boolean;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { t, i18n } = useTranslation();
  const time = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Box
      data-testid={`admin-support-row-${row.id}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        flexWrap: 'wrap',
        py: 1.25,
        borderBottom: `1px solid ${surface.hair}`,
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 220 }}>
        <Typography sx={{ ...typo.panelTitle, color: ink.hi }}>
          {showHotel ? `${row.subdomain} · ` : ''}
          {row.actor}
        </Typography>
        <Typography sx={{ color: ink.low, ...typo.caption, mt: 0.25 }}>
          {t('admin.support.line', {
            user: row.as_user,
            from: time(row.started_at),
            until: time(row.expires_at),
          })}
        </Typography>
        {row.reason ? (
          <Typography sx={{ color: ink.low, ...typo.caption }}>{row.reason}</Typography>
        ) : null}
      </Box>

      {/* Выдан код, но им ещё не воспользовались: в отеле пока никого нет. */}
      <Box sx={{ ...pillSx, opacity: row.entered ? 1 : 0.6 }}>
        {t(row.entered ? 'admin.support.inside' : 'admin.support.notYet')}
      </Box>

      <Button
        size="small"
        color="error"
        disabled={busy}
        onClick={onRevoke}
        data-testid={`admin-support-revoke-${row.id}`}
      >
        {t('admin.support.revoke')}
      </Button>
    </Box>
  );
}
