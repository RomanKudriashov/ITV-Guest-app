import { useEffect, useMemo, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { AllergenLine, FlagChips } from './ItemMeta';
import { QuantityStepper } from './QuantityStepper';
import { errorMessage } from '../errors';
import { useGuestItem } from '../hooks/useGuestQueries';
import { useMoney } from '../hooks/useMoney';
import { toCartModifier, unitPriceOf, useCart } from '../state/cart';
import { useDraftState } from '@/state/useDraftState';
import type { ItemDetail, MenuItem, ModifierGroup } from '../api/types';

interface SheetDraft {
  /** group id → selected option ids. */
  selections: Record<string, string[]>;
  quantity: number;
  comment: string;
  showErrors: boolean;
}

function seedSelections(groups: ModifierGroup[]): Record<string, string[]> {
  const selections: Record<string, string[]> = {};
  for (const group of groups) {
    selections[group.id] = group.options
      .filter((option) => option.is_default)
      .slice(0, group.selection === 'single' ? 1 : group.max_choices || undefined)
      .map((option) => option.id);
  }
  return selections;
}

function unmetGroups(groups: ModifierGroup[], selections: Record<string, string[]>) {
  return groups.filter((group) => {
    const chosen = selections[group.id]?.length ?? 0;
    const min = group.is_required ? Math.max(1, group.min_choices || 1) : group.min_choices || 0;
    return chosen < min;
  });
}

export interface ItemSheetProps {
  itemId: string | null;
  /** Row data from the menu — renders the sheet instantly while details load. */
  listItem?: MenuItem | null;
  onClose: () => void;
}

/** Dish card as a bottom sheet: modifiers, quantity, comment, sticky add button. */
export function ItemSheet({ itemId, listItem, onClose }: ItemSheetProps) {
  const { t } = useTranslation();
  const { format, delta } = useMoney();
  const cart = useCart();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const seedDetail =
    listItem && listItem.modifier_groups
      ? ({ ...listItem, modifier_groups: listItem.modifier_groups } as ItemDetail)
      : undefined;

  const { data, isLoading, error } = useGuestItem(itemId, seedDetail);
  const item = data ?? (listItem ? ({ ...listItem, modifier_groups: [] } as ItemDetail) : null);
  const groups = useMemo(() => data?.modifier_groups ?? [], [data]);

  // Draft state: seeded once per dish (and once more when the details land), then
  // owned by the guest. A background refetch of the item never touches it.
  const [draft, setDraft] = useDraftState<SheetDraft>(
    () => ({
      selections: seedSelections(groups),
      quantity: 1,
      comment: '',
      showErrors: false,
    }),
    `${itemId ?? 'none'}:${data ? 'loaded' : 'pending'}`,
  );

  const selectedOptions = useMemo(() => {
    const result: { groupCode: string; option: ModifierGroup['options'][number] }[] = [];
    for (const group of groups) {
      for (const optionId of draft.selections[group.id] ?? []) {
        const option = group.options.find((candidate) => candidate.id === optionId);
        if (option) result.push({ groupCode: group.code, option });
      }
    }
    return result;
  }, [groups, draft.selections]);

  const basePrice = item?.price ?? 0;
  const unitPrice = unitPriceOf(
    basePrice,
    selectedOptions.map((entry) => entry.option),
  );
  const totalPrice = unitPrice * draft.quantity;

  const missing = unmetGroups(groups, draft.selections);
  const unavailable = item ? !item.is_available : false;

  // Move focus into the sheet so screen readers announce the dish, not the page.
  useEffect(() => {
    if (!itemId) return;
    const handle = window.setTimeout(() => titleRef.current?.focus(), 120);
    return () => window.clearTimeout(handle);
  }, [itemId]);

  const toggleOption = (group: ModifierGroup, optionId: string) => {
    setDraft((prev) => {
      const current = prev.selections[group.id] ?? [];
      let next: string[];
      if (group.selection === 'single') {
        next = [optionId];
      } else if (current.includes(optionId)) {
        next = current.filter((id) => id !== optionId);
      } else {
        const max = group.max_choices || Infinity;
        next = current.length >= max ? current : [...current, optionId];
      }
      return { ...prev, selections: { ...prev.selections, [group.id]: next } };
    });
  };

  const handleAdd = () => {
    if (!item || unavailable) return;
    if (missing.length) {
      setDraft((prev) => ({ ...prev, showErrors: true }));
      return;
    }
    cart.addLine({
      item_id: item.id,
      item_code: item.code,
      category_id: item.category_id,
      title: item.title,
      image_url: item.images?.[0] ?? null,
      base_price: basePrice,
      unit_price: unitPrice,
      quantity: draft.quantity,
      comment: draft.comment.trim(),
      modifiers: selectedOptions.map((entry) =>
        toCartModifier(entry.option, entry.groupCode),
      ),
    });
    onClose();
  };

  return (
    <Drawer
      anchor="bottom"
      open={Boolean(itemId)}
      onClose={onClose}
      keepMounted={false}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: '92dvh',
        },
      }}
    >
      <Box
        data-testid="guest-item-sheet"
        role="dialog"
        aria-modal
        aria-label={item?.title ?? t('guest.item.title')}
        sx={{ display: 'flex', flexDirection: 'column', maxHeight: '92dvh' }}
      >
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          display: 'flex',
          justifyContent: 'flex-end',
          p: 1,
          bgcolor: 'background.paper',
        }}
      >
        <IconButton
          onClick={onClose}
          aria-label={t('guest.common.close')}
          data-testid="guest-item-sheet-close"
          sx={{ minWidth: 44, minHeight: 44 }}
        >
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ overflowY: 'auto', px: 2, pb: 2, flexGrow: 1 }}>
        {isLoading && !item ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress aria-label={t('guest.common.loading')} />
          </Stack>
        ) : null}

        {error && !item ? (
          <Alert severity="error">{errorMessage(error, t)}</Alert>
        ) : null}

        {item ? (
          <Stack spacing={2}>
            {item.images?.[0] ? (
              <Box
                component="img"
                src={item.images[0]}
                alt={item.title}
                sx={{
                  width: '100%',
                  aspectRatio: '16 / 9',
                  objectFit: 'cover',
                  borderRadius: 3,
                  bgcolor: 'brand.surfaceMuted',
                }}
              />
            ) : null}

            <Stack spacing={1}>
              <Typography variant="h5" component="h2" ref={titleRef} tabIndex={-1}>
                {item.title}
              </Typography>
              <Typography variant="h6" color="primary.main">
                {format(item.price)}
              </Typography>
              {item.description ? (
                <Typography variant="body2" color="text.secondary">
                  {item.description}
                </Typography>
              ) : null}
              <FlagChips flags={item.flags ?? []} />
              <AllergenLine allergens={item.allergens ?? []} />
            </Stack>

            {unavailable ? (
              <Alert severity="warning">
                {item.available_from
                  ? t('guest.menu.availableFrom', { time: item.available_from })
                  : t('guest.menu.unavailable')}
              </Alert>
            ) : null}

            {groups.map((group) => {
              const chosen = draft.selections[group.id] ?? [];
              const isMissing = draft.showErrors && missing.some((g) => g.id === group.id);
              return (
                <Box key={group.id}>
                  <Divider sx={{ mb: 1.5 }} />
                  <Stack
                    direction="row"
                    alignItems="baseline"
                    justifyContent="space-between"
                    sx={{ mb: 0.5 }}
                  >
                    <Typography variant="subtitle1">{group.title}</Typography>
                    <Typography
                      variant="caption"
                      color={isMissing ? 'error.main' : 'text.secondary'}
                    >
                      {group.is_required
                        ? t('guest.item.required')
                        : group.selection === 'multi' && group.max_choices
                          ? t('guest.item.upTo', { count: group.max_choices })
                          : t('guest.item.optional')}
                    </Typography>
                  </Stack>
                  <Stack role={group.selection === 'single' ? 'radiogroup' : 'group'}>
                    {group.options.map((option) => {
                      const checked = chosen.includes(option.id);
                      return (
                        <FormControlLabel
                          key={option.id}
                          checked={checked}
                          onChange={() => toggleOption(group, option.id)}
                          data-testid={`guest-modifier-option-${option.code}`}
                          control={group.selection === 'single' ? <Radio /> : <Checkbox />}
                          sx={{
                            minHeight: 44,
                            m: 0,
                            justifyContent: 'space-between',
                            flexDirection: 'row-reverse',
                          }}
                          label={
                            <Stack
                              direction="row"
                              spacing={1}
                              alignItems="center"
                              justifyContent="space-between"
                              sx={{ width: '100%' }}
                            >
                              <Typography variant="body2">{option.title}</Typography>
                              {option.price_delta ? (
                                <Typography variant="body2" color="text.secondary">
                                  {delta(option.price_delta)}
                                </Typography>
                              ) : null}
                            </Stack>
                          }
                          slotProps={{ typography: { sx: { flexGrow: 1 } } }}
                        />
                      );
                    })}
                  </Stack>
                  {isMissing ? (
                    <Typography variant="caption" color="error.main">
                      {t('guest.item.chooseRequired')}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}

            <Divider />

            <TextField
              fullWidth
              multiline
              minRows={2}
              label={t('guest.item.comment')}
              placeholder={t('guest.item.commentPlaceholder')}
              value={draft.comment}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, comment: event.target.value }))
              }
              inputProps={{ maxLength: 300, 'data-testid': 'guest-item-comment' }}
            />

            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle1">{t('guest.item.quantity')}</Typography>
              <QuantityStepper
                // Prefixed: the menu row behind the sheet already owns
                // `guest-qty-plus-<code>`, and two matches would break E2E.
                code={`sheet-${item.code}`}
                value={draft.quantity}
                min={1}
                onIncrement={() =>
                  setDraft((prev) => ({ ...prev, quantity: Math.min(99, prev.quantity + 1) }))
                }
                onDecrement={() =>
                  setDraft((prev) => ({ ...prev, quantity: Math.max(1, prev.quantity - 1) }))
                }
              />
            </Stack>
          </Stack>
        ) : null}
      </Box>

      <Box
        sx={{
          p: 2,
          pb: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={!item || unavailable}
          onClick={handleAdd}
          data-testid="guest-add-to-cart"
          sx={{ minHeight: 52 }}
        >
          {t('guest.item.addToCart', { price: format(totalPrice) })}
        </Button>
      </Box>
      </Box>
    </Drawer>
  );
}
