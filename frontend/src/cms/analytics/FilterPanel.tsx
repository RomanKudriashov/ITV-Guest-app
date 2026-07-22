import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';

import type { AnalyticsScope, Dimension, PeriodPreset } from '@/api/analyticsTypes';
import { LANGUAGE_LABELS, type SupportedLanguage } from '@/i18n';
import { FILTER_DIMENSIONS, STATIC_DIMENSION_VALUES } from './dimensions';
import type { UseAnalyticsFilters } from './useAnalyticsFilters';

const PRESETS: Exclude<PeriodPreset, 'custom'>[] = ['today', 'week', 'month'];

interface Option {
  key: string;
  label: string;
}

export function FilterPanel({
  controller,
  scope,
}: {
  controller: UseAnalyticsFilters;
  scope: AnalyticsScope | undefined;
}) {
  const { t } = useTranslation();
  const { filters, setPreset, setCustomRange, toggleCompare, setDimension, clearDimensions } =
    controller;

  const isAdmin = Boolean(scope?.is_hotel_admin || scope?.is_platform_admin);

  const valueLabel = (dimension: Dimension, value: string): string => {
    if (dimension === 'language') {
      return LANGUAGE_LABELS[value as SupportedLanguage] ?? value;
    }
    const key = `analytics.values.${dimension}.${value}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };

  const optionsFor = (dimension: Dimension): { options: Option[]; locked: boolean } => {
    // Point options come from the permission scope — a point-scoped user only
    // ever sees their own points, and a single-point user is pinned.
    if (dimension === 'point') {
      const points = scope?.points ?? [];
      const options = points.map((p) => ({ key: p.id, label: p.title }));
      const locked = !isAdmin && points.length === 1;
      return { options, locked };
    }

    const stat = STATIC_DIMENSION_VALUES[dimension];
    if (stat) {
      return {
        options: stat.map((value) => ({ key: value, label: valueLabel(dimension, value) })),
        locked: false,
      };
    }

    // Data-driven dimensions: options from scope; keep the active value present
    // even if scope hasn't listed it (e.g. a value reached via drill-down).
    const fromScope = scope?.dimensions?.[dimension] ?? [];
    const options: Option[] = fromScope.map((v) => ({ key: v.key, label: v.label }));
    const active = filters.dimensions[dimension];
    if (active && !options.some((o) => o.key === active)) {
      options.unshift({ key: active, label: active });
    }
    return { options, locked: false };
  };

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="analytics-filter-panel">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', md: 'center' }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <ToggleButtonGroup
                size="small"
                exclusive
                color="primary"
                value={filters.preset === 'custom' ? null : filters.preset}
                onChange={(_e, next) => {
                  if (next) setPreset(next as PeriodPreset);
                }}
                aria-label={t('analytics.filters.period')}
              >
                {PRESETS.map((preset) => (
                  <ToggleButton
                    key={preset}
                    value={preset}
                    data-testid={`analytics-filter-preset-${preset}`}
                  >
                    {t(`analytics.presets.${preset}`)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>

              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  type="date"
                  size="small"
                  label={t('analytics.filters.from')}
                  InputLabelProps={{ shrink: true }}
                  value={filters.dateFrom}
                  onChange={(e) => setCustomRange(e.target.value, filters.dateTo || e.target.value)}
                  inputProps={{ 'data-testid': 'analytics-filter-date-from' }}
                />
                <TextField
                  type="date"
                  size="small"
                  label={t('analytics.filters.to')}
                  InputLabelProps={{ shrink: true }}
                  value={filters.dateTo}
                  onChange={(e) => setCustomRange(filters.dateFrom || e.target.value, e.target.value)}
                  inputProps={{ 'data-testid': 'analytics-filter-date-to' }}
                />
              </Stack>
            </Stack>

            <FormControlLabel
              control={
                <Switch
                  checked={filters.compare}
                  onChange={(e) => toggleCompare(e.target.checked)}
                  inputProps={
                    { 'data-testid': 'analytics-compare-toggle' } as React.InputHTMLAttributes<HTMLInputElement>
                  }
                />
              }
              label={t('analytics.filters.compare')}
            />
          </Stack>

          <Box>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle2" color="text.secondary">
                {t('analytics.filters.dimensions')}
              </Typography>
              <Button
                size="small"
                onClick={clearDimensions}
                disabled={Object.keys(filters.dimensions).length === 0}
                data-testid="analytics-filter-clear"
              >
                {t('analytics.filters.clear')}
              </Button>
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              }}
            >
              {FILTER_DIMENSIONS.map((dimension) => {
                const { options, locked } = optionsFor(dimension);
                const value = filters.dimensions[dimension] ?? '';
                return (
                  <TextField
                    key={dimension}
                    select
                    size="small"
                    label={t(`analytics.dimensions.${dimension}`)}
                    value={value}
                    disabled={locked || options.length === 0}
                    onChange={(e) => setDimension(dimension, e.target.value || null)}
                    SelectProps={{
                      SelectDisplayProps: {
                        'data-testid': `analytics-filter-${dimension}`,
                      } as React.HTMLAttributes<HTMLDivElement>,
                    }}
                  >
                    <MenuItem value="">
                      <em>{t('analytics.filters.all')}</em>
                    </MenuItem>
                    {options.map((option) => (
                      <MenuItem key={option.key} value={option.key}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              })}
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
