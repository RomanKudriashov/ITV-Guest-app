import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/auth';
import {
  defaultPlace,
  placeIsComplete,
  PlacePicker,
  type PlaceChoice,
} from '@/guest/components/PlacePicker';
import type { CreateOrderPayload, MenuItem as CatalogItem } from '@/guest/api/types';
import { formatMoney } from '@/utils/money';
import { useTrackerLanguage } from '../hooks/useTrackerQueries';
import {
  fetchDeskCatalog,
  fetchDeskItem,
  fetchDeskLocations,
  fetchDeskVenues,
  placeDeskOrder,
  quoteDeskCart,
} from './api';
import { DeskModifierPicker } from './DeskModifierPicker';

interface DeskLine {
  key: string;
  item: CatalogItem;
  quantity: number;
  optionIds: string[];
  optionTitles: string[];
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * ЗАКАЗ ОТ ИМЕНИ ГОСТЯ — прямо из диалога.
 *
 * Тот же каталог, те же места (матрица, самовывоз) и тот же расчёт, что у
 * гостя: сервер считает всё сам. Корзина — одного заведения, как у гостя.
 * Оплаты нет; чаевые ресепшен не ставит.
 */
export function DeskOrderDialog({
  threadId,
  open,
  onClose,
  onPlaced,
}: {
  threadId: string;
  open: boolean;
  onClose: () => void;
  onPlaced: (number: number) => void;
}) {
  const { t } = useTranslation();
  const language = useTrackerLanguage();
  const { hotel } = useAuth();
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const queryClient = useQueryClient();
  const [venueCode, setVenueCode] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<DeskLine[]>([]);
  const [place, setPlace] = useState<PlaceChoice | null>(null);
  const [comment, setComment] = useState('');
  const [picking, setPicking] = useState<CatalogItem | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  // Ключ идемпотентности — на одно открытие диалога: повторный клик не
  // создаст второй заказ.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  const venues = useQuery({
    queryKey: ['tracker', 'desk', 'venues', language],
    queryFn: () => fetchDeskVenues(language),
    enabled: open,
  });
  const venue = venues.data?.venues.find((v) => v.code === venueCode) ?? null;
  const catalog = useQuery({
    queryKey: ['tracker', 'desk', 'catalog', venue?.point, language],
    queryFn: () => fetchDeskCatalog(venue!.point, language),
    enabled: open && Boolean(venue),
  });

  const itemIds = lines.map((line) => line.item.id);
  const locations = useQuery({
    queryKey: ['tracker', 'desk', 'locations', threadId, itemIds.join(','), language],
    queryFn: () => fetchDeskLocations(threadId, itemIds, language),
    enabled: open && lines.length > 0,
  });
  const places = locations.data?.locations ?? [];
  const choice =
    place && places.some((p) => p.id === place.locationId) ? place : defaultPlace(places);

  const payload: CreateOrderPayload = {
    service_code: venue?.code,
    lines: lines.map((line) => ({
      item_id: line.item.id,
      quantity: line.quantity,
      modifier_option_ids: line.optionIds,
      comment: '',
    })),
    location_id: choice.locationId ?? undefined,
    location_refinement: choice.refinement,
    timing: 'asap',
    requested_time: null,
    comment,
  };

  const quote = useQuery({
    queryKey: ['tracker', 'desk', 'quote', threadId, JSON.stringify(payload)],
    queryFn: () => quoteDeskCart(threadId, payload),
    enabled: open && lines.length > 0,
  });

  const submit = useMutation({
    mutationFn: () => placeDeskOrder(threadId, payload, idempotencyKey),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: ['tracker', 'chat'] });
      onPlaced(order.number);
      reset();
    },
  });

  const reset = () => {
    setLines([]);
    setPlace(null);
    setComment('');
    setSearch('');
    setShowErrors(false);
    setIdempotencyKey(newKey());
  };

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (catalog.data?.categories ?? [])
      .map((category) => ({
        category,
        items: category.items.filter(
          (item) =>
            item.is_orderable !== false &&
            !item.has_fields &&
            (!term || item.title.toLowerCase().includes(term)),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [catalog.data, search]);

  const money = (minor: number | null | undefined) =>
    minor == null
      ? '—'
      : formatMoney(minor, hotel?.currency ?? 'RUB', hotel?.currency_minor_units ?? 2, language, {
          trimZeroFraction: true,
        });

  const add = (item: CatalogItem, optionIds: string[] = [], optionTitles: string[] = []) => {
    setLines((previous) => {
      const signature = `${item.id}|${[...optionIds].sort().join(',')}`;
      const found = previous.find(
        (line) => `${line.item.id}|${[...line.optionIds].sort().join(',')}` === signature,
      );
      if (found) {
        return previous.map((line) =>
          line === found ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...previous, { key: newKey(), item, quantity: 1, optionIds, optionTitles }];
    });
  };
  const change = (key: string, delta: number) =>
    setLines((previous) =>
      previous
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );

  const switchVenue = (code: string) => {
    // Корзина — одного заведения: другое заведение начинает её заново.
    setVenueCode(code);
    setLines([]);
    setPlace(null);
  };

  const canSubmit =
    lines.length > 0 &&
    placeIsComplete(places, choice) &&
    !quote.data?.below_minimum &&
    !submit.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      fullScreen={narrow}
      data-testid="desk-order-dialog"
    >
      <DialogTitle>{t('tracker.desk.order.title')}</DialogTitle>
      <DialogContent dividers>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 360px' },
            gap: 2,
          }}
        >
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <TextField
                select
                size="small"
                label={t('tracker.desk.order.venue')}
                value={venueCode}
                onChange={(event) => switchVenue(event.target.value)}
                sx={{ minWidth: 220 }}
                SelectProps={{ SelectDisplayProps: { 'data-testid': 'desk-order-venue' } as never }}
              >
                {(venues.data?.venues ?? []).map((v) => (
                  <MenuItem key={v.code} value={v.code} data-testid={`desk-order-venue-${v.code}`}>
                    {v.title}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label={t('tracker.desk.order.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                inputProps={{ 'data-testid': 'desk-order-search' }}
                disabled={!venue}
              />
            </Stack>
            {!venue ? (
              <Typography variant="body2" color="text.secondary">
                {t('tracker.desk.order.pickVenue')}
              </Typography>
            ) : (
              <Stack
                spacing={1.5}
                sx={{ maxHeight: { md: '55vh' }, overflowY: 'auto' }}
                data-testid="desk-order-catalog"
              >
                {items.map(({ category, items: rows }) => (
                  <Stack key={category.id} spacing={0.5}>
                    <Typography variant="overline" color="text.secondary">
                      {category.title}
                    </Typography>
                    {rows.map((item) => (
                      <Stack
                        key={item.id}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        data-testid={`desk-order-item-${item.code}`}
                      >
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {item.title}
                          </Typography>
                          <Typography
                            variant="caption"
                            color={item.is_available ? 'text.secondary' : 'warning.main'}
                          >
                            {item.is_available
                              ? money(item.price)
                              : t('tracker.desk.order.unavailable')}
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!item.is_available}
                          onClick={() => (item.has_modifiers ? setPicking(item) : add(item))}
                          data-testid={`desk-order-add-${item.code}`}
                        >
                          {t('tracker.desk.order.add')}
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                ))}
                <Typography variant="caption" color="text.secondary">
                  {t('tracker.desk.order.formsHint')}
                </Typography>
              </Stack>
            )}
          </Stack>

          <Stack spacing={1.5} data-testid="desk-order-cart">
            <Typography variant="subtitle2">{t('tracker.desk.order.cart')}</Typography>
            {lines.length ? (
              <Stack spacing={0.75}>
                {lines.map((line) => (
                  <Stack key={line.key} direction="row" spacing={0.5} alignItems="center">
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {line.item.title}
                      </Typography>
                      {line.optionTitles.length ? (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {line.optionTitles.join(', ')}
                        </Typography>
                      ) : null}
                    </Box>
                    <IconButton size="small" onClick={() => change(line.key, -1)} aria-label="−">
                      <RemoveIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="body2" data-testid={`desk-order-qty-${line.item.code}`}>
                      {line.quantity}
                    </Typography>
                    <IconButton size="small" onClick={() => change(line.key, 1)} aria-label="+">
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t('tracker.desk.order.empty')}
              </Typography>
            )}

            {lines.length ? (
              <>
                <Divider />
                <Typography variant="subtitle2">{t('tracker.desk.order.where')}</Typography>
                {places.length ? (
                  <PlacePicker
                    locations={places}
                    choice={choice}
                    onChange={setPlace}
                    showErrors={showErrors}
                    testPrefix="desk-order-location"
                  />
                ) : locations.isLoading ? null : (
                  <Alert severity="warning">{t('tracker.desk.order.noPlace')}</Alert>
                )}
                <TextField
                  size="small"
                  multiline
                  minRows={2}
                  label={t('tracker.desk.order.comment')}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  inputProps={{ 'data-testid': 'desk-order-comment', maxLength: 500 }}
                />
                <Divider />
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle2">{t('tracker.desk.order.total')}</Typography>
                  <Typography variant="subtitle2" data-testid="desk-order-total">
                    {quote.data ? money(quote.data.total_minor) : '…'}
                  </Typography>
                </Stack>
                {quote.data && quote.data.delivery_fee_minor > 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('tracker.desk.order.delivery', {
                      amount: money(quote.data.delivery_fee_minor),
                    })}
                  </Typography>
                ) : null}
                {quote.data?.below_minimum ? (
                  <Alert severity="warning">
                    {t('tracker.desk.order.belowMinimum', {
                      amount: money(quote.data.shortfall_minor),
                    })}
                  </Alert>
                ) : null}
                <Chip size="small" variant="outlined" label={t('tracker.desk.order.noPayment')} />
              </>
            ) : null}
            {submit.error ? (
              <Alert severity="error" data-testid="desk-order-error">
                {submit.error instanceof Error
                  ? submit.error.message
                  : t('tracker.desk.order.failed')}
              </Alert>
            ) : null}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('tracker.desk.order.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!canSubmit}
          onClick={() => {
            setShowErrors(true);
            if (placeIsComplete(places, choice)) submit.mutate();
          }}
          data-testid="desk-order-submit"
        >
          {t('tracker.desk.order.submit')}
        </Button>
      </DialogActions>

      {picking ? (
        <DeskModifierPicker
          itemId={picking.id}
          title={picking.title}
          loader={(id) => fetchDeskItem(id, language)}
          onClose={() => setPicking(null)}
          onPick={(ids, titles) => {
            add(picking, ids, titles);
            setPicking(null);
          }}
        />
      ) : null}
    </Dialog>
  );
}
