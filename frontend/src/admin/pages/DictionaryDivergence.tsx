import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { ink, panelSx, typo } from '../adminTokens';
import {
  getDictionaryDivergence,
  resetDictionary,
  type DivergenceHotel,
} from '../adminClient';

/**
 * РАСХОЖДЕНИЕ КОПИЙ С ЭТАЛОНОМ — числом и поимённо.
 *
 * Раньше его не было видно вовсе: правка эталона не доезжала до отелей, а
 * сравнить копию с источником было нечем, кроме как руками в базе. Экран
 * отвечает на три вопроса: сколько отелей разошлось, по каким записям и что с
 * этим делать.
 *
 * «ВЕРНУТЬ К ЭТАЛОНУ» — ЯВНОЕ ДЕЙСТВИЕ. Правка отеля не перетирается
 * автоматически никогда: ни при изменении эталона, ни при заведении новой
 * записи. Здесь оператор называет отели сам и видит, скольких это коснётся.
 *
 * СВОИ ЗАПИСИ ОТЕЛЯ В РАСХОЖДЕНИЯ НЕ ВХОДЯТ. У них нет эталона, возвращать их
 * не к чему — это собственность отеля, а не отклонение от нашего списка.
 */
export function DictionaryDivergence() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const report = useQuery({
    queryKey: ['admin', 'dictionary', 'divergence'],
    queryFn: getDictionaryDivergence,
  });

  const reset = useMutation({
    mutationFn: (hotelIds: string[]) => resetDictionary(hotelIds),
    onSuccess: () => {
      setPicked([]);
      void qc.invalidateQueries({ queryKey: ['admin', 'dictionary'] });
    },
  });

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Box sx={{ mt: 3 }} data-testid="admin-dict-divergence">
      <QueryState query={report} what={t('admin.templates.divergence.title')}>
        {(data) => {
          const diverged = data.hotels.filter((row) => row.counts.diverged > 0);
          return (
            <Box sx={{ ...panelSx, p: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                <Typography sx={typo.panelTitle}>
                  {t('admin.templates.divergence.title')}
                </Typography>
                {/*
                  ЧИСЛО ПЕРВЫМ. «Разошлись 3 из 15» — то, ради чего сюда
                  заходят; список нужен уже после ответа на этот вопрос.
                */}
                <Chip
                  size="small"
                  color={diverged.length ? 'warning' : 'success'}
                  label={t('admin.templates.divergence.count', {
                    diverged: data.diverged_hotels,
                    total: data.total_hotels,
                  })}
                  data-testid="admin-dict-divergence-count"
                />
              </Stack>

              {diverged.length === 0 ? (
                // Одна строка, а не пустая таблица: «все следуют эталону» —
                // это ответ, а не отсутствие данных.
                <Typography sx={{ ...typo.caption, color: ink.low }} data-testid="admin-dict-divergence-clean">
                  {t('admin.templates.divergence.clean')}
                </Typography>
              ) : (
                <>
                  <Typography sx={{ ...typo.caption, color: ink.low, mb: 1.5, maxWidth: 720 }}>
                    {t('admin.templates.divergence.hint')}
                  </Typography>

                  {diverged.map((row) => (
                    <HotelRow
                      key={row.hotel_id}
                      row={row}
                      expanded={open === row.hotel_id}
                      picked={picked.includes(row.hotel_id)}
                      onToggleOpen={() => setOpen(open === row.hotel_id ? null : row.hotel_id)}
                      onPick={() => toggle(row.hotel_id)}
                      onReset={() => reset.mutate([row.hotel_id])}
                      busy={reset.isPending}
                    />
                  ))}

                  {picked.length ? (
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5 }}>
                      <Typography sx={{ ...typo.caption, color: ink.mid }}>
                        {t('admin.templates.divergence.picked', { count: picked.length })}
                      </Typography>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={reset.isPending}
                        onClick={() => reset.mutate(picked)}
                        data-testid="admin-dict-reset-picked"
                      >
                        {t('admin.templates.divergence.resetPicked')}
                      </Button>
                    </Stack>
                  ) : null}
                </>
              )}
            </Box>
          );
        }}
      </QueryState>
    </Box>
  );
}

function HotelRow({
  row,
  expanded,
  picked,
  onToggleOpen,
  onPick,
  onReset,
  busy,
}: {
  row: DivergenceHotel;
  expanded: boolean;
  picked: boolean;
  onToggleOpen: () => void;
  onPick: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', py: 1 }} data-testid={`admin-dict-diverged-${row.subdomain}`}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Checkbox
          size="small"
          checked={picked}
          onChange={onPick}
          inputProps={{ 'data-testid': `admin-dict-pick-${row.subdomain}` } as never}
        />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ ...typo.caption, color: ink.hi }}>{row.name}</Typography>
          <Typography sx={{ ...typo.caption, color: ink.low }}>{row.subdomain}</Typography>
        </Box>
        {/*
          Расхождения РАЗНЫЕ, и складывать их в одно число нельзя: «нет записи»
          лечится нарезкой, «погашено отелем» — это его решение, и возвращать
          его к эталону значит спорить с ним.
        */}
        {(['changed', 'missing', 'disabled'] as const).map((state) =>
          row.counts[state] ? (
            <Chip
              key={state}
              size="small"
              variant="outlined"
              label={`${t(`admin.templates.divergence.states.${state}`)}: ${row.counts[state]}`}
              data-testid={`admin-dict-count-${state}-${row.subdomain}`}
            />
          ) : null,
        )}
        <Button size="small" onClick={onToggleOpen} data-testid={`admin-dict-details-${row.subdomain}`}>
          {t(expanded ? 'common.close' : 'admin.templates.divergence.details')}
        </Button>
        <Button
          size="small"
          disabled={busy}
          onClick={onReset}
          data-testid={`admin-dict-reset-${row.subdomain}`}
        >
          {t('admin.templates.divergence.reset')}
        </Button>
      </Stack>

      <Collapse in={expanded} unmountOnExit>
        <Stack spacing={0.5} sx={{ pl: 5, py: 1 }}>
          {row.entries.map((entry) => (
            <Typography
              key={`${entry.kind}:${entry.code}`}
              sx={{ ...typo.caption, color: ink.mid }}
              data-testid={`admin-dict-entry-${entry.code}`}
            >
              <b>{entry.code}</b> · {t(`admin.templates.divergence.states.${entry.state}`)}
              {entry.state === 'changed' && entry.source && entry.local
                ? ` · ${JSON.stringify(entry.source.title)} → ${JSON.stringify(entry.local.title)}`
                : ''}
            </Typography>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}
