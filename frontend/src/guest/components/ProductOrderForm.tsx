import { useMemo, type Ref } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { nextOpening } from '../nextOpening';

import { ChipOption, ctaGradientSx } from '@/kit';
import { useDraftState } from '@/state/useDraftState';
import { AddonGroup, isAddonGroup } from './ItemAddons';
import { ItemHeadline } from './ItemHeadline';
import { QuantityStepper } from './QuantityStepper';
import { SheetFooter, SheetScroll } from './sheetLayout';
import { useMoney } from '../hooks/useMoney';
import { toCartModifier, unitPriceOf, useCart } from '../state/cart';
import type { ItemDetail, ModifierGroup } from '../api/types';
import { itemCard } from '../storefrontTokens';

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
        <Stack spacing={itemCard.section}>
          <ItemHeadline item={item} ref={titleRef} />

          {groups.map((group) => {
            const chosen = draft.selections[group.id] ?? [];
            const isMissing = draft.showErrors && missing.some((g) => g.id === group.id);
            // Добавки — карточки с ценой и кнопкой, модификаторы — чипы.
            // Признак берётся из данных группы, а не из её кода: см. `isAddonGroup`.
            if (isAddonGroup(group)) {
              return (
                <Box key={group.id}>
                  <Divider sx={{ mb: itemCard.block }} />
                  <AddonGroup
                    group={group}
                    chosen={chosen}
                    priceOf={(option) => (option.price_delta ? delta(option.price_delta) : null)}
                    onToggle={(optionId) => toggleOption(group, optionId)}
                  />
                </Box>
              );
            }
            return (
              <Box key={group.id}>
                <Divider sx={{ mb: itemCard.block }} />
                <Stack
                  direction="row"
                  alignItems="baseline"
                  spacing={1}
                  sx={{ mb: itemCard.block }}
                >
                  <Typography variant="subtitle1">{group.title}</Typography>
                  {group.is_required ? (
                    // Reference `.grphd em` — an accent-outlined "обязательно" pill.
                    <Box
                      component="span"
                      sx={(theme) => ({
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: isMissing ? 'error.main' : 'primary.main',
                        border: `1px solid ${isMissing ? theme.palette.error.main : theme.palette.primary.main}`,
                        borderRadius: `${theme.palette.brand.radius.pill}px`,
                        px: 1,
                        py: 0.25,
                        lineHeight: 1.4,
                      })}
                    >
                      {t('guest.item.required')}
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {group.selection === 'multi' && group.max_choices
                        ? t('guest.item.upTo', { count: group.max_choices })
                        : t('guest.item.optional')}
                    </Typography>
                  )}
                </Stack>
                <Stack
                  direction="row"
                  flexWrap="wrap"
                  useFlexGap
                  spacing={0}
                  sx={{ gap: 1.25 }}
                  role={group.selection === 'single' ? 'radiogroup' : 'group'}
                  aria-label={group.title}
                >
                  {group.options.map((option) => (
                    <ChipOption
                      key={option.id}
                      testId={`guest-modifier-option-${option.code}`}
                      role={group.selection === 'single' ? 'radio' : 'checkbox'}
                      label={option.title}
                      hint={option.price_delta ? delta(option.price_delta) : undefined}
                      selected={chosen.includes(option.id)}
                      onToggle={() => toggleOption(group, option.id)}
                    />
                  ))}
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
        {/*
          ЗАКАЗАТЬ НЕЛЬЗЯ — ГОВОРИМ ЭТО СЛОВАМИ, А НЕ ПОГАШЕННОЙ КНОПКОЙ.

          Кнопка «Добавить · 1 900 ₽», которая не нажимается, — это загадка:
          гость жмёт её несколько раз, потом трясёт телефон, потом уходит.
          Причина у сервера уже есть, и она разная: закрыто заведение, кончилось
          на кухне, расписание самой позиции. Каждая говорит своё.
        */}
        {unavailable ? (
          <Box
            data-testid="guest-item-unavailable"
            sx={{
              minHeight: 52,
              display: 'grid',
              placeItems: 'center',
              px: 2,
              borderRadius: 2,
              bgcolor: 'action.hover',
              color: 'text.secondary',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {unavailableLabel(item, t)}
          </Box>
        ) : (
          <Button
            fullWidth
            size="large"
            variant="contained"
            onClick={handleAdd}
            data-testid="guest-add-to-cart"
            sx={[ctaGradientSx, { minHeight: 52 }]}
          >
            {t('guest.item.addToCart', { price: format(totalPrice) })}
          </Button>
        )}
      </SheetFooter>
    </>
  );
}

/**
 * Почему позиция недоступна — И КОГДА БУДЕТ.
 *
 * Раньше здесь стояло «с {{time}}»: только час, без дня. У сырников окно
 * закрылось в полдень, а экран писал «с 07:00» — гость читал это как
 * «откроются в семь» и ждал того, чего сегодня уже не будет.
 *
 * Заведение закрыто — отдельная ветка и отдельные слова: «подождать до утра» и
 * «идти в другое место» это разные новости.
 */
function unavailableLabel(
  item: { unavailable_reason?: string | null; available_from?: string | null; available_at?: string | null },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const next = nextOpening(item.available_from, item.available_at);
  const venue = item.unavailable_reason === 'venue_closed';

  if (next) {
    const suffix = venue ? 'Venue' : '';
    switch (next.kind) {
      case 'today':
        return t(`guest.menu.opens${suffix}Today`, { time: next.time });
      case 'tomorrow':
        return t(`guest.menu.opens${suffix}Tomorrow`, { time: next.time });
      case 'later':
        return t(`guest.menu.opens${suffix}On`, {
          time: next.time,
          day: next.at.toLocaleDateString(undefined, { weekday: 'long' }),
        });
      case 'unknown':
        // Дня не знаем — не обещаем его. Час показать всё же полезнее, чем
        // молчать, но «сегодня» тут сказано быть не может.
        return t(venue ? 'guest.menu.venueOpensAt' : 'guest.menu.availableFrom', { time: next.time });
      default:
        break;
    }
  }

  if (venue) return t('guest.menu.venueClosed');
  if (item.unavailable_reason === 'out_of_stock') return t('guest.menu.outOfStock');
  return t('guest.menu.unavailable');
}
