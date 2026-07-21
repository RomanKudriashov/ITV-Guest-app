import type { ModifierGroup, ModifierOption, Translated } from '@/api/types';
import {
  createModifierGroup,
  createModifierOption,
  deleteModifierGroup,
  deleteModifierOption,
  reorderModifierGroups,
  reorderModifierOptions,
  updateModifierGroup,
  updateModifierOption,
} from '@/api/cms';
import { compactTranslated } from '@/utils/translated';
import { minorToInput } from '@/utils/money';

/** Local, editable shape of a modifier option (price kept as typed text). */
export interface DraftOption {
  /** Stable local key — options are edited before they exist on the server. */
  key: string;
  id?: string;
  title: Translated;
  priceInput: string;
  is_default: boolean;
  is_active: boolean;
}

export interface DraftGroup {
  key: string;
  id?: string;
  title: Translated;
  selection: 'single' | 'multi';
  is_required: boolean;
  min_choices: number;
  max_choices: number;
  options: DraftOption[];
}

export function newKey(): string {
  return Math.random().toString(36).slice(2);
}

export function emptyGroup(): DraftGroup {
  return {
    key: newKey(),
    title: {},
    selection: 'single',
    is_required: false,
    min_choices: 0,
    max_choices: 1,
    options: [],
  };
}

export function emptyOption(): DraftOption {
  return {
    key: newKey(),
    title: {},
    priceInput: '0.00',
    is_default: false,
    is_active: true,
  };
}

export function groupsToDrafts(
  groups: ModifierGroup[] | undefined,
  minorUnits: number,
): DraftGroup[] {
  return (groups ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((group) => ({
      key: group.id,
      id: group.id,
      title: { ...group.title },
      selection: group.selection,
      is_required: group.is_required,
      min_choices: group.min_choices,
      max_choices: group.max_choices,
      options: (group.options ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((option: ModifierOption) => ({
          key: option.id,
          id: option.id,
          title: { ...option.title },
          priceInput: minorToInput(option.price_delta, minorUnits),
          is_default: option.is_default,
          is_active: option.is_active,
        })),
    }));
}

export interface ModifierValidationError {
  /** `group:<key>` or `option:<key>` */
  target: string;
  field: string;
  messageKey: string;
}

/**
 * Mirrors the server rules from §5 of the contract so the user gets instant
 * feedback; the server remains the source of truth and its 422s are surfaced
 * on the same fields.
 */
export function validateGroups(
  groups: DraftGroup[],
  defaultLanguage: string,
  parsePrice: (value: string) => number | null,
): ModifierValidationError[] {
  const errors: ModifierValidationError[] = [];

  for (const group of groups) {
    const target = `group:${group.key}`;
    if (!group.title[defaultLanguage]?.trim()) {
      errors.push({ target, field: 'title', messageKey: 'validation.titleRequired' });
    }
    if (group.selection === 'single' && group.max_choices !== 1) {
      errors.push({ target, field: 'max_choices', messageKey: 'validation.singleMaxOne' });
    }
    if (group.is_required && group.min_choices < 1) {
      errors.push({ target, field: 'min_choices', messageKey: 'validation.requiredMinOne' });
    }
    if (group.min_choices > group.max_choices) {
      errors.push({ target, field: 'min_choices', messageKey: 'validation.minLessThanMax' });
    }
    const activeOptions = group.options.filter((option) => option.is_active);
    if (group.is_required && activeOptions.length === 0) {
      errors.push({ target, field: 'options', messageKey: 'validation.requiredGroupEmpty' });
    }
    if (group.min_choices > activeOptions.length && activeOptions.length > 0) {
      errors.push({ target, field: 'min_choices', messageKey: 'validation.notEnoughOptions' });
    }

    for (const option of group.options) {
      const optionTarget = `option:${option.key}`;
      if (!option.title[defaultLanguage]?.trim()) {
        errors.push({
          target: optionTarget,
          field: 'title',
          messageKey: 'validation.titleRequired',
        });
      }
      if (parsePrice(option.priceInput) === null) {
        errors.push({
          target: optionTarget,
          field: 'price_delta',
          messageKey: 'validation.priceInvalid',
        });
      }
    }
  }

  return errors;
}

/** Applies `selection=single` ⇒ `max_choices=1` and `required` ⇒ `min>=1`. */
export function normalizeGroup(group: DraftGroup): DraftGroup {
  const next = { ...group };
  if (next.selection === 'single') next.max_choices = 1;
  if (next.is_required && next.min_choices < 1) next.min_choices = 1;
  if (!next.is_required && next.min_choices < 0) next.min_choices = 0;
  if (next.min_choices > next.max_choices) next.min_choices = next.max_choices;
  return next;
}

/**
 * Persists the local draft tree: deletes removed nodes, creates new ones,
 * patches the rest and finally fixes the order with the reorder endpoints.
 */
export async function syncModifierGroups(
  itemId: string,
  drafts: DraftGroup[],
  original: ModifierGroup[],
  toMinor: (value: string) => number,
): Promise<void> {
  const keptGroupIds = new Set(drafts.map((group) => group.id).filter(Boolean) as string[]);
  for (const group of original) {
    if (!keptGroupIds.has(group.id)) await deleteModifierGroup(group.id);
  }

  const resolvedGroupIds: string[] = [];

  for (const [index, draft] of drafts.entries()) {
    const payload = {
      title: compactTranslated(draft.title),
      selection: draft.selection,
      is_required: draft.is_required,
      min_choices: draft.min_choices,
      max_choices: draft.max_choices,
      sort_order: index,
    };

    let groupId = draft.id;
    if (groupId) {
      await updateModifierGroup(groupId, payload);
    } else {
      const created = await createModifierGroup(itemId, payload);
      groupId = created.id;
    }
    resolvedGroupIds.push(groupId);

    const originalGroup = original.find((group) => group.id === draft.id);
    const keptOptionIds = new Set(
      draft.options.map((option) => option.id).filter(Boolean) as string[],
    );
    for (const option of originalGroup?.options ?? []) {
      if (!keptOptionIds.has(option.id)) await deleteModifierOption(option.id);
    }

    const resolvedOptionIds: string[] = [];
    for (const [optionIndex, option] of draft.options.entries()) {
      const optionPayload = {
        title: compactTranslated(option.title),
        price_delta: toMinor(option.priceInput),
        is_default: option.is_default,
        is_active: option.is_active,
        sort_order: optionIndex,
      };
      if (option.id) {
        await updateModifierOption(option.id, optionPayload);
        resolvedOptionIds.push(option.id);
      } else {
        const created = await createModifierOption(groupId, optionPayload);
        resolvedOptionIds.push(created.id);
      }
    }

    if (resolvedOptionIds.length > 1) {
      await reorderModifierOptions(
        groupId,
        resolvedOptionIds.map((id, order) => ({ id, sort_order: order })),
      );
    }
  }

  if (resolvedGroupIds.length > 1) {
    await reorderModifierGroups(
      itemId,
      resolvedGroupIds.map((id, order) => ({ id, sort_order: order })),
    );
  }
}
