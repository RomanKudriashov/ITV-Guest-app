import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, panelSx, pillSx, surface } from '../adminTokens';
import { QueryState } from '../QueryState';
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
  const sessions = useQuery({ queryKey: ['admin', 'impersonations'], queryFn: getImpersonations });

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
  const mine = (all: ImpersonationRow[]) =>
    hotelId ? all.filter((row) => row.hotel_id === hotelId) : all;

  return (
    <Box data-testid="admin-support-sessions">
      {hotelId ? null : (
        <>
          <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
            {t('admin.support.title')}
          </Typography>
          <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
            {t('admin.support.subtitle')}
          </Typography>
        </>
      )}

      {error ? (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <QueryState
        query={sessions}
        what={t('admin.state.what.support')}
        isEmpty={(all) => mine(all).length === 0}
        emptyText={t('admin.support.empty')}
      >
        {(all) => (
          <Box sx={{ ...panelSx, mt: hotelId ? 0 : 2.25 }}>
            {mine(all).map((row) => (
              <SessionRow
                key={row.id}
                row={row}
                showHotel={!hotelId}
                busy={revoke.isPending}
                onRevoke={() => revoke.mutate(row.id)}
              />
            ))}
          </Box>
        )}
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
        <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
          {showHotel ? `${row.subdomain} · ` : ''}
          {row.actor}
        </Typography>
        <Typography sx={{ color: ink.low, fontSize: 12.5, mt: 0.25 }}>
          {t('admin.support.line', {
            user: row.as_user,
            from: time(row.started_at),
            until: time(row.expires_at),
          })}
        </Typography>
        {row.reason ? (
          <Typography sx={{ color: ink.low, fontSize: 12.5 }}>{row.reason}</Typography>
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
