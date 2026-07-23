import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { fetchShowcase, putShowcase } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { CmsShowcaseTile } from '@/api/types';
import { useToast } from '@/components/ToastProvider';

const SIZES: Array<CmsShowcaseTile['size']> = ['s', 'm', 'l'];

/**
 * CMS editor for the guest home bento. The hotel reorders the tiles, sets each
 * one's size (S/M/L) and visibility, and the grouping threshold that decides when
 * several venues collapse into a single category tile. The tile SET is computed
 * from data — the hotel tunes presentation, it does not hand-author tiles.
 */
export function ShowcaseEditorPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({ queryKey: queryKeys.showcase, queryFn: fetchShowcase });

  const [threshold, setThreshold] = useState(3);
  const [tiles, setTiles] = useState<CmsShowcaseTile[]>([]);
  const [baseline, setBaseline] = useState('');

  useEffect(() => {
    if (query.data) {
      setThreshold(query.data.group_threshold);
      setTiles(query.data.tiles);
      setBaseline(JSON.stringify({ t: query.data.group_threshold, tiles: query.data.tiles }));
    }
  }, [query.data]);

  const dirty = useMemo(
    () => JSON.stringify({ t: threshold, tiles }) !== baseline,
    [threshold, tiles, baseline],
  );

  const mutation = useMutation({
    mutationFn: () =>
      putShowcase({
        group_threshold: threshold,
        tiles: tiles.map((tile, index) => ({
          key: tile.key,
          size: tile.size,
          sort_order: index + 1, // 1-based — position is the source of order
          is_enabled: tile.shown,
        })),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.showcase, data);
      toast.show(t('showcaseCms.saved'), 'success');
    },
    onError: () => toast.show(t('showcaseCms.saveError'), 'error'),
  });

  const move = (index: number, delta: number) => {
    setTiles((prev) => {
      const next = [...prev];
      const to = index + delta;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  };

  const patch = (key: string, change: Partial<CmsShowcaseTile>) =>
    setTiles((prev) => prev.map((tile) => (tile.key === key ? { ...tile, ...change } : tile)));

  if (query.isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
        <CircularProgress aria-label={t('showcaseCms.loading')} />
      </Box>
    );
  }

  return (
    <Box data-testid="cms-showcase" sx={{ maxWidth: 760, mx: 'auto', p: { xs: 2, md: 3 } }}>
      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {t('showcaseCms.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('showcaseCms.subtitle')}
        </Typography>
      </Stack>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
            <Stack spacing={0.25}>
              <Typography sx={{ fontWeight: 600 }}>{t('showcaseCms.threshold')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('showcaseCms.thresholdHint')}
              </Typography>
            </Stack>
            <TextField
              type="number"
              size="small"
              value={threshold}
              onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
              inputProps={{ min: 0, max: 20, 'data-testid': 'cms-showcase-threshold', style: { width: 64 } }}
            />
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={1.5}>
        {tiles.map((tile, index) => (
          <Card key={tile.key} variant="outlined" data-testid={`cms-showcase-tile-${tile.key}`}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Stack>
                  <IconButton size="small" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('showcaseCms.moveUp')}>
                    <ArrowUpwardIcon fontSize="inherit" />
                  </IconButton>
                  <IconButton size="small" disabled={index === tiles.length - 1} onClick={() => move(index, 1)} aria-label={t('showcaseCms.moveDown')}>
                    <ArrowDownwardIcon fontSize="inherit" />
                  </IconButton>
                </Stack>

                <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>
                    {tile.title}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={t(`showcaseCms.type.${tile.type}`, { defaultValue: tile.type })} />
                    {tile.venue_count != null ? (
                      <Typography variant="caption" color="text.secondary">
                        {t('showcaseCms.venueCount', { count: tile.venue_count })}
                      </Typography>
                    ) : null}
                  </Stack>
                </Stack>

                <TextField
                  select
                  size="small"
                  label={t('showcaseCms.size')}
                  value={tile.size}
                  onChange={(e) => patch(tile.key, { size: e.target.value as CmsShowcaseTile['size'] })}
                  inputProps={{ 'data-testid': `cms-showcase-size-${tile.key}` }}
                  sx={{ width: 96 }}
                >
                  {SIZES.map((size) => (
                    <MenuItem key={size} value={size}>
                      {size.toUpperCase()}
                    </MenuItem>
                  ))}
                </TextField>

                <Switch
                  checked={tile.shown}
                  onChange={(e) => patch(tile.key, { shown: e.target.checked })}
                  inputProps={{ 'aria-label': t('showcaseCms.shown'), 'data-testid': `cms-showcase-shown-${tile.key}` } as never}
                />
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {!tiles.length ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('showcaseCms.empty')}
        </Alert>
      ) : null}

      <Box sx={{ position: 'sticky', bottom: 0, mt: 3, py: 2, bgcolor: 'background.default' }}>
        <Button
          variant="contained"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="cms-showcase-save"
        >
          {mutation.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </Box>
    </Box>
  );
}
