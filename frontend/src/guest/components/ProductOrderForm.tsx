import { useMemo, type Ref } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useDraftState } from '@/state/useDraftState';
import { ItemHeadline } from './ItemHeadline';
import { QuantityStepper } from './QuantityStepper';
import { SheetFooter, SheetScroll } from './sheetLayout';
import { useMoney } from '../hooks/useMoney';
import { toCartModifier, unitPriceOf, useCart } from '../state/cart';
import type { ItemDetail, ModifierGroup } from '../api/types';

interface ProductDraft {
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

export interface ProductOrderFormProps {
  item: ItemDetail;
  /** True once the full item (with its groups) has arrived. */
  detailLoaded: boolean;
  titleRef: Ref<HTMLHeadingElement>;
  onClose: () => void;
}

/**
 * Body of the sheet for an offering the guest fills in with a CART:
 * modifiers, quantity, comment — and "add", not "send".
 */
export function ProductOrderForm({ item, detailLoaded, titleRef, onClose }: ProductOrderFormProps) {
  const { t } = useTranslation();
  const { format, delta } = useMoney();
  const cart = useCart();

  const groups = useMemo(() => item.modifier_groups ?? [], [item]);

  // Draft state: seeded once per dish (and once more when the details land),
  // then owned by the guest. A background refetch never touches it.
  const [draft, setDraft] = useDraftState<ProductDraft>(
    () => ({
      selections: seedSelections(groups),
      quantity: 1,
      comment: '',
      showErrors: false,
    }),
    `${item.id}:${detailLoaded ? 'loaded' : 'pending'}`,
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

  const basePrice = item.price ?? 0;
  const unitPrice = unitPriceOf(
    basePrice,
    selectedOptions.map((entry) => entry.option),
  );
  const totalPrice = unitPrice * draft.quantity;
  const missing = unmetGroups(groups, draft.selections);
  const unavailable = !item.is_available;

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
    if (unavailable) return;
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
      modifiers: selectedOptions.map((entry) => toCartModifier(entry.option, entry.groupCode)),
    });
    onClose();
  };

  return (
    <>
      <SheetScroll>
        <Stack spacing={2}>
          <ItemHeadline item={item} ref={titleRef} />

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
            onChange={(event) => setDraft((prev) => ({ ...prev, comment: event.target.value }))}
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
      </SheetScroll>

      <SheetFooter>
        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={unavailable}
          onClick={handleAdd}
          data-testid="guest-add-to-cart"
          sx={{ minHeight: 52 }}
        >
          {t('guest.item.addToCart', { price: format(totalPrice) })}
        </Button>
      </SheetFooter>
    </>
  );
}
