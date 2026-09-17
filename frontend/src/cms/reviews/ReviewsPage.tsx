import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useTranslation } from 'react-i18next';

import { fetchScope } from '@/api/analytics';
import { QueryState } from '@/components/QueryState';
import { ListEmpty } from '@/kit/list/ListEmpty';
import { useListQuery } from '@/kit/list/useListQuery';
import { LineChart } from '../analytics/charts/InlineCharts';
import { StatTile } from '../analytics/StatTile';
import { useAnalyticsLanguage, useMetricFormatters } from '../analytics/format';
import {
  fetchReviewsPage,
  fetchReviewsSummary,
  type CmsReview,
  type ReviewsFilters,
  type ReviewsPage as ReviewsPageBody,
} from './api';
import { ReviewCard } from './ReviewCard';

const DEFAULTS = { point_id: '', rating: '', date_from: '', date_to: '' };

/**
 * РАЗДЕЛ «ОТЗЫВЫ»: что гости сказали и что мы с этим сделали.
 *
 * Средняя в динамике считается ЗДЕСЬ, тем же отбором, что и список, — не
 * берётся из «Аналитики». Там отзыв о заказе из двух заведений лежит на
 * агрегате, здесь — на каждой части; два правила на одном экране разошлись
 * бы у руководителя бара на первом же таком заказе.
 *
 * Фильтры живут в адресе: ссылку «низкие по бару за неделю» можно послать.
 */
export function ReviewsPage() {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();
  const language = useAnalyticsLanguage();
  const { params, patch, reset, isFiltered } = useListQuery(DEFAULTS);
  const filters: ReviewsFilters = params;

  // Листание — в состоянии, не в адресе: это место в списке, а не фильтр.
  const [extra, setExtra] = useState<CmsReview[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryClient = useQueryClient();

  const scope = useQuery({ queryKey: ['cms', 'analytics', 'scope'], queryFn: fetchScope });
  const summary = useQuery({
    queryKey: ['cms', 'reviews', 'summary', params],
    queryFn: () => fetchReviewsSummary(filters),
  });
  const list = useQuery({
    queryKey: ['cms', 'reviews', 'list', params],
    queryFn: async () => {
      const page = await fetchReviewsPage(filters);
      setExtra([]);
      return page;
    },
  });

  const loadMore = async () => {
    if (!list.data) return;
    setLoadingMore(true);
    try {
      const shown = list.data.items.length + extra.length;
      const page = await fetchReviewsPage(filters, shown);
      // Новый отзыв мог сдвинуть страницы — повтор уже показанного отсеиваем.
      setExtra((previous) => {
        const seen = new Set([...list.data!.items, ...previous].map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
    } finally {
      setLoadingMore(false);
    }
  };

  // Ответ меняет ОДНУ карточку: кладём её на место, не перечитывая список —
  // перечитывание сбросило бы догруженные страницы.
  const replace = (next: CmsReview) => {
    queryClient.setQueryData<ReviewsPageBody>(['cms', 'reviews', 'list', params], (page) =>
      page ? { ...page, items: page.items.map((item) => (item.id === next.id ? next : item)) } : page,
    );
    setExtra((previous) => previous.map((item) => (item.id === next.id ? next : item)));
  };

  const venues = scope.data?.points ?? [];
  const body = summary.data;

  return (
    <Stack spacing={2} data-testid="cms-reviews">
      <Typography variant="h5" data-testid="cms-page-title">
        {t('reviews.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('reviews.subtitle')}
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label={t('reviews.filters.venue')}
              value={params.point_id}
              onChange={(event) => patch({ point_id: event.target.value })}
              sx={{ minWidth: 180 }}
              SelectProps={{
                SelectDisplayProps: { 'data-testid': 'reviews-filter-venue' } as never,
              }}
            >
              <MenuItem value="">{t('reviews.filters.allVenues')}</MenuItem>
              {venues.map((venue) => (
                <MenuItem key={venue.id} value={venue.id}>
                  {venue.title}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('reviews.filters.rating')}
              value={params.rating}
              onChange={(event) => patch({ rating: event.target.value })}
              sx={{ minWidth: 150 }}
              SelectProps={{
                SelectDisplayProps: { 'data-testid': 'reviews-filter-rating' } as never,
              }}
            >
              <MenuItem value="">{t('reviews.filters.anyRating')}</MenuItem>
              <MenuItem value="low" data-testid="reviews-filter-rating-low">
                {t('reviews.filters.low')}
              </MenuItem>
              {[5, 4, 3, 2, 1].map((n) => (
                <MenuItem key={n} value={String(n)}>
                  {t('reviews.filters.stars', { count: n })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="date"
              size="small"
              label={t('reviews.filters.since')}
              value={params.date_from}
              onChange={(event) => patch({ date_from: event.target.value })}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'reviews-filter-since' }}
            />
            <TextField
              type="date"
              size="small"
              label={t('reviews.filters.until')}
              value={params.date_to}
              onChange={(event) => patch({ date_to: event.target.value })}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'reviews-filter-until' }}
            />
            {isFiltered ? (
              <Button onClick={reset} data-testid="reviews-filter-reset">
                {t('reviews.filters.reset')}
              </Button>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Box
        sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
      >
        <StatTile
          testId="reviews-count"
          label={t('reviews.numbers.count')}
          value={body ? fmt.count(body.count) : undefined}
          loading={summary.isLoading}
        />
        <StatTile
          testId="reviews-avg"
          label={t('reviews.numbers.avg')}
          value={body?.avg_rating != null ? fmt.rating(body.avg_rating) : body ? '—' : undefined}
          loading={summary.isLoading}
        />
        <StatTile
          testId="reviews-low"
          label={t('reviews.numbers.low', { threshold: body?.low_threshold ?? 2 })}
          value={body?.low_rate != null ? fmt.percent(body.low_rate) : body ? '—' : undefined}
          loading={summary.isLoading}
        />
      </Box>

      {body && body.trend.length > 1 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              {t('reviews.trend')}
            </Typography>
            <LineChart
              testId="reviews-trend"
              points={body.trend.map((point) => ({
                label: new Intl.DateTimeFormat(language, { day: '2-digit', month: 'short' }).format(
                  new Date(point.day),
                ),
                value: point.avg_rating,
              }))}
              formatValue={(value) => fmt.rating(value)}
              ariaLabel={t('reviews.trend')}
            />
          </CardContent>
        </Card>
      ) : null}

      <QueryState query={list} what={t('reviews.what')}>
        {(page) => {
          const rows = [...page.items, ...extra];
          if (!rows.length) {
            return (
              <ListEmpty
                isFiltered={isFiltered}
                onReset={reset}
                what={t('reviews.what')}
                emptyHint={t('reviews.emptyHint')}
              />
            );
          }
          return (
            <Stack spacing={1} data-testid="reviews-list">
              <Typography variant="caption" color="text.secondary" data-testid="reviews-shown">
                {t('reviews.shown', { shown: rows.length, total: page.total })}
              </Typography>
              {rows.map((review) => (
                <ReviewCard key={review.id} review={review} onChanged={replace} />
              ))}
              {rows.length < page.total ? (
                <Button
                  variant="outlined"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  data-testid="reviews-load-more"
                  sx={{ alignSelf: 'center' }}
                >
                  {t('reviews.loadMore')}
                </Button>
              ) : null}
            </Stack>
          );
        }}
      </QueryState>
    </Stack>
  );
}
