import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

import { fetchBreakdown, fetchSummary } from '@/api/analytics';
import type { BreakdownRow, Dimension, SortOrder } from '@/api/analyticsTypes';
import { queryKeys } from '@/api/queryKeys';
import { BREAKDOWN_DIMENSIONS, nextDrillDimension } from '../dimensions';
import { BreakdownTable } from '../BreakdownTable';
import { DrilldownPanel } from '../DrilldownPanel';
import { SummaryCards } from '../SummaryCards';
import { TimeseriesPanel } from '../TimeseriesPanel';
import type { UseAnalyticsFilters } from '../useAnalyticsFilters';

export function SalesTab({ controller }: { controller: UseAnalyticsFilters }) {
  const { t } = useTranslation();
  const [dimension, setDimension] = useState<Dimension>('type');
  const [sort, setSort] = useState<string>('revenue_minor');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [drilldownOpen, setDrilldownOpen] = useState(false);

  const baseParams = controller.toQuery();
  const baseSlice = controller.sliceKey();

  const summary = useQuery({
    queryKey: queryKeys.analyticsSummary(baseSlice),
    queryFn: () => fetchSummary(baseParams),
    retry: 1,
  });

  const breakdownParams = controller.toQuery({ dimension, sort, order });
  const breakdownSlice = controller.sliceKey({ dimension, sort, order });
  const breakdown = useQuery({
    queryKey: queryKeys.analyticsBreakdown(breakdownSlice),
    queryFn: () => fetchBreakdown(breakdownParams),
    retry: 1,
  });

  const onSort = (column: string) => {
    if (sort === column) setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(column);
      setOrder('desc');
    }
  };

  // Drill: narrow the global filter by the clicked value, then either descend
  // to the next axis (type → category → item) or reveal the concrete orders.
  const onDrill = (row: BreakdownRow) => {
    controller.setDimension(dimension, row.key);
    const next = nextDrillDimension(dimension);
    if (next) {
      setDimension(next);
    } else {
      setDrilldownOpen(true);
    }
  };

  return (
    <Stack spacing={2}>
      <SummaryCards data={summary.data} isLoading={summary.isLoading} compare={controller.filters.compare} />

      <TimeseriesPanel params={baseParams} sliceKey={baseSlice} />

      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
            sx={{ mb: 1.5 }}
          >
            <Typography variant="subtitle1">{t('analytics.breakdown.title')}</Typography>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                select
                size="small"
                label={t('analytics.breakdown.dimension')}
                value={dimension}
                onChange={(e) => {
                  setDimension(e.target.value as Dimension);
                  setDrilldownOpen(false);
                }}
                sx={{ minWidth: 170 }}
                SelectProps={{
                  SelectDisplayProps: {
                    'data-testid': 'analytics-breakdown-dimension',
                  } as React.HTMLAttributes<HTMLDivElement>,
                }}
              >
                {BREAKDOWN_DIMENSIONS.map((dim) => (
                  <MenuItem key={dim} value={dim}>
                    {t(`analytics.dimensions.${dim}`)}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ReceiptLongIcon />}
                onClick={() => setDrilldownOpen(true)}
                data-testid="analytics-view-orders"
              >
                {t('analytics.drilldown.viewOrders')}
              </Button>
            </Stack>
          </Stack>

          <BreakdownTable
            rows={breakdown.data?.rows ?? []}
            isLoading={breakdown.isLoading}
            isError={breakdown.isError}
            sort={sort}
            order={order}
            onSort={onSort}
            onDrill={onDrill}
            canDrill
          />
        </CardContent>
      </Card>

      {drilldownOpen ? (
        <DrilldownPanel
          params={baseParams}
          sliceKey={baseSlice}
          onClose={() => setDrilldownOpen(false)}
        />
      ) : null}
    </Stack>
  );
}
