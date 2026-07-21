import {
  createRequestField,
  deleteRequestField,
  reorderRequestFields,
  updateRequestField,
} from '@/api/cms';
import type { RequestField, RequestFieldOption, Translated } from '@/api/types';
import { fieldSpec, type RequestFieldType } from '@/offerings/requestFields';
import { compactTranslated } from '@/utils/translated';

/**
 * Local, editable shape of a request field — the exact counterpart of
 * `modifierDrafts.ts` for the other kind of item body. Bounds are kept as typed
 * text so an empty box means "no bound", not zero.
 */
export interface DraftFieldOption {
  key: string;
  value: string;
  label: Translated;
}

export interface DraftField {
  /** Stable local key — fields are edited before they exist on the server. */
  key: string;
  id?: string;
  code: string;
  label: Translated;
  help_text: Translated;
  field_type: RequestFieldType;
  is_required: boolean;
  minInput: string;
  maxInput: string;
  options: DraftFieldOption[];
}

export function newKey(): string {
  return Math.random().toString(36).slice(2);
}

export function emptyField(): DraftField {
  return {
    key: newKey(),
    code: '',
    label: {},
    help_text: {},
    field_type: 'text',
    is_required: false,
    minInput: '',
    maxInput: '',
    options: [],
  };
}

export function emptyFieldOption(): DraftFieldOption {
  return { key: newKey(), value: '', label: {} };
}

function numberInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseBound(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined; // undefined ⇒ not a number
}

export function fieldsToDrafts(fields: RequestField[] | undefined): DraftField[] {
  return (fields ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((field) => ({
      key: field.id,
      id: field.id,
      code: field.code ?? '',
      label: { ...field.label },
      help_text: { ...(field.help_text ?? {}) },
      field_type: field.field_type,
      is_required: field.is_required,
      minInput: numberInput(field.min_value),
      maxInput: numberInput(field.max_value),
      options: (field.options ?? []).map((option) => ({
        key: newKey(),
        value: option.value,
        label: { ...option.label },
      })),
    }));
}

export interface RequestFieldValidationError {
  /** `field:<key>` or `option:<key>` */
  target: string;
  field: string;
  messageKey: string;
}

/**
 * Mirrors the server rules of §5a so the editor gives instant feedback; the
 * server stays the source of truth and its 422s land on the same inputs.
 */
export function validateFields(
  fields: DraftField[],
  defaultLanguage: string,
): RequestFieldValidationError[] {
  const errors: RequestFieldValidationError[] = [];
  const seenCodes = new Map<string, number>();

  for (const field of fields) {
    const target = `field:${field.key}`;
    const spec = fieldSpec(field.field_type);

    if (!field.label[defaultLanguage]?.trim()) {
      errors.push({ target, field: 'label', messageKey: 'validation.labelRequired' });
    }

    const code = field.code.trim();
    if (code) {
      const count = (seenCodes.get(code) ?? 0) + 1;
      seenCodes.set(code, count);
      if (count > 1) {
        errors.push({ target, field: 'code', messageKey: 'validation.codeDuplicate' });
      }
    }

    if (spec.supportsOptions && field.options.length === 0) {
      errors.push({ target, field: 'options', messageKey: 'validation.selectWithoutOptions' });
    }

    if (spec.supportsBounds) {
      const min = parseBound(field.minInput);
      const max = parseBound(field.maxInput);
      if (min === undefined) {
        errors.push({ target, field: 'min_value', messageKey: 'validation.numberInvalid' });
      }
      if (max === undefined) {
        errors.push({ target, field: 'max_value', messageKey: 'validation.numberInvalid' });
      }
      if (
        typeof min === 'number' &&
        typeof max === 'number' &&
        min > max
      ) {
        errors.push({ target, field: 'min_value', messageKey: 'validation.invalidRange' });
      }
    }

    const seenValues = new Set<string>();
    for (const option of field.options) {
      const optionTarget = `option:${option.key}`;
      if (!option.value.trim()) {
        errors.push({
          target: optionTarget,
          field: 'value',
          messageKey: 'validation.optionValueRequired',
        });
      } else if (seenValues.has(option.value.trim())) {
        errors.push({
          target: optionTarget,
          field: 'value',
          messageKey: 'validation.codeDuplicate',
        });
      } else {
        seenValues.add(option.value.trim());
      }
      if (!option.label[defaultLanguage]?.trim()) {
        errors.push({
          target: optionTarget,
          field: 'label',
          messageKey: 'validation.labelRequired',
        });
      }
    }
  }

  return errors;
}

/**
 * Drops what the chosen field type cannot carry: bounds outside number/count and
 * options outside select. Keeping them would send the server data it rejects.
 */
export function normalizeField(field: DraftField): DraftField {
  const spec = fieldSpec(field.field_type);
  return {
    ...field,
    minInput: spec.supportsBounds ? field.minInput : '',
    maxInput: spec.supportsBounds ? field.maxInput : '',
    options: spec.supportsOptions ? field.options : [],
  };
}

function toOptions(field: DraftField): RequestFieldOption[] {
  return field.options.map((option) => ({
    value: option.value.trim(),
    label: compactTranslated(option.label),
  }));
}

/**
 * Persists the local draft list: deletes removed fields, creates new ones,
 * patches the rest and fixes the order with the reorder endpoint — the same
 * shape of sync `syncModifierGroups` performs for the other body.
 */
export async function syncRequestFields(
  itemId: string,
  drafts: DraftField[],
  original: RequestField[],
): Promise<void> {
  const kept = new Set(drafts.map((field) => field.id).filter(Boolean) as string[]);
  for (const field of original) {
    if (!kept.has(field.id)) await deleteRequestField(field.id);
  }

  const resolvedIds: string[] = [];

  for (const [index, draft] of drafts.entries()) {
    const spec = fieldSpec(draft.field_type);
    const payload = {
      label: compactTranslated(draft.label),
      help_text: compactTranslated(draft.help_text),
      field_type: draft.field_type,
      is_required: draft.is_required,
      options: spec.supportsOptions ? toOptions(draft) : [],
      min_value: spec.supportsBounds ? (parseBound(draft.minInput) ?? null) : null,
      max_value: spec.supportsBounds ? (parseBound(draft.maxInput) ?? null) : null,
      sort_order: index,
      ...(draft.code.trim() ? { code: draft.code.trim() } : {}),
    };

    if (draft.id) {
      await updateRequestField(draft.id, payload);
      resolvedIds.push(draft.id);
    } else {
      const created = await createRequestField(itemId, payload);
      resolvedIds.push(created.id);
    }
  }

  if (resolvedIds.length > 1) {
    await reorderRequestFields(
      itemId,
      resolvedIds.map((id, order) => ({ id, sort_order: order })),
    );
  }
}
