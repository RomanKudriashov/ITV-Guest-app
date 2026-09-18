import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { api } from '@/api/client';
import { QueryState } from '@/components/QueryState';

/**
 * Переводы витрины: где дыры и чем их закрыть.
 *
 * МОДЕЛИ ПОКА НЕТ, И ЭКРАН ОБ ЭТОМ ГОВОРИТ ПРЯМО. Кнопка не притворяется
 * работающей, поля не заполняются похожим на перевод текстом: заглушка уехала
 * бы в публикацию, и отель не отличил бы её от настоящего перевода.
 *
 * Зато охват работает уже сейчас и приносит половину пользы: «английский —
 * 296 из 815» показывает, что переводить руками, и в каком разделе.
 *
 * «Похоже на чужой язык» — отдельная колонка, а не часть «готово»: русская
 * строка под ключом `en` заполненной не считается.
 */
interface GroupRow {
  group: string;
  total: number;
  filled: number;
  suspicious: number;
}

interface LanguageRow {
  language: string;
  total: number;
  filled: number;
  missing: number;
  suspicious: number;
  groups: GroupRow[];
}

interface Coverage {
  source_language: string;
  languages: LanguageRow[];
  groups: { group: string; fields: string[] }[];
  provider: { name: string; connected: boolean };
}

interface UsageRow {
  period: string;
  calls: number;
  characters: number;
}

export function TranslationSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const coverage = useQuery({
    queryKey: ['cms', 'translate', 'coverage'],
    queryFn: () => api.get<Coverage>('/cms/translate/coverage'),
  });
  const usage = useQuery({
    queryKey: ['cms', 'translate', 'usage'],
    queryFn: () => api.get<{ items: UsageRow[] }>('/cms/translate/usage'),
  });

  const start = useMutation({
    mutationFn: (language: string) => api.post('/cms/translate/runs', { languages: [language] }),
    onSuccess: () => {
      setNotice(null);
      queryClient.invalidateQueries({ queryKey: ['cms', 'translate'] });
    },
    // Отказ показываем словами сервера: «Автоперевод пока не подключён» — это
    // не ошибка экрана, это состояние механизма.
    onError: (cause) => setNotice(cause instanceof Error ? cause.message : t('settings.translate.notConnected')),
  });

  return (
    <Box data-testid="settings-translate">
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {t('settings.translate.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('settings.translate.subtitle')}
      </Typography>

      <QueryState query={coverage} what={t('state.what.translateCoverage')}>
        {(data) => (
          <Stack spacing={2}>
            {!data.provider.connected && (
              <Alert severity="info" data-testid="cms-translate-not-connected">
                {t('settings.translate.notConnected')}
              </Alert>
            )}
            {notice && (
              <Alert severity="warning" data-testid="cms-translate-notice">
                {notice}
              </Alert>
            )}

            <Table size="small" data-testid="cms-translate-coverage">
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.translate.language')}</TableCell>
                  <TableCell>{t('settings.translate.done')}</TableCell>
                  <TableCell>{t('settings.translate.suspicious')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.languages.map((row) => (
                  <Fragment key={row.language}>
                    <TableRow data-testid={`cms-translate-row-${row.language}`}>
                      <TableCell>{t(`analytics.values.language.${row.language}`, row.language)}</TableCell>
                      <TableCell data-testid={`cms-translate-done-${row.language}`}>
                        {t('settings.translate.ofTotal', { filled: row.filled, total: row.total })}
                        <LinearProgress
                          variant="determinate"
                          value={row.total ? (row.filled / row.total) * 100 : 0}
                          sx={{ mt: 0.5, width: 160 }}
                        />
                      </TableCell>
                      <TableCell data-testid={`cms-translate-suspicious-${row.language}`}>
                        {row.suspicious ? (
                          <Chip size="small" color="warning" label={row.suspicious} />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            size="small"
                            onClick={() => setOpened(opened === row.language ? null : row.language)}
                            data-testid={`cms-translate-details-${row.language}`}
                          >
                            {t('settings.translate.details')}
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={!data.provider.connected || start.isPending}
                            onClick={() => start.mutate(row.language)}
                            data-testid={`cms-translate-run-${row.language}`}
                          >
                            {data.provider.connected
                              ? t('settings.translate.run')
                              : t('settings.translate.notConnectedShort')}
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                    {opened === row.language &&
                      row.groups.map((group) => (
                        <TableRow key={`${row.language}-${group.group}`}>
                          <TableCell sx={{ pl: 4 }} colSpan={2}>
                            <Typography variant="body2" color="text.secondary">
                              {group.group}:{' '}
                              {t('settings.translate.ofTotal', {
                                filled: group.filled,
                                total: group.total,
                              })}
                            </Typography>
                          </TableCell>
                          <TableCell colSpan={2}>
                            <Typography variant="body2" color="text.secondary">
                              {group.suspicious
                                ? t('settings.translate.suspiciousCount', { count: group.suspicious })
                                : ''}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>

            <Typography variant="body2" color="text.secondary">
              {t('settings.translate.whatIsCounted', {
                groups: data.groups.map((group) => group.group).join(', '),
              })}
            </Typography>

            {(usage.data?.items.length ?? 0) > 0 && (
              <Box data-testid="cms-translate-usage">
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {t('settings.translate.usage')}
                </Typography>
                {usage.data?.items.map((row) => (
                  <Typography key={row.period} variant="body2" color="text.secondary">
                    {t('settings.translate.usageRow', {
                      period: row.period,
                      calls: row.calls,
                      characters: row.characters,
                    })}
                  </Typography>
                ))}
              </Box>
            )}
          </Stack>
        )}
      </QueryState>
    </Box>
  );
}
