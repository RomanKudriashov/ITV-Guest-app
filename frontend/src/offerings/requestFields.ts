/**
 * Request-field type table — the frontend twin of `apps/catalog/request_fields.py`.
 *
 * This is the one place in the app that branches on a type, and it is the type
 * of a FIELD (`text`, `count`, `select`, …), not the type of an offering. Both
 * the CMS constructor and the guest form read this table instead of listing
 * `if (field_type === 'select')` in their own markup.
 */

export type RequestFieldType = 'text' | 'number' | 'count' | 'date' | 'time' | 'select';

/** Which control the guest gets. The CMS reads the same row for its editor. */
export type RequestFieldControl = 'text' | 'number' | 'stepper' | 'date' | 'time' | 'select';

export interface RequestFieldTypeSpec {
  type: RequestFieldType;
  control: RequestFieldControl;
  /** `options` are meaningful (and mandatory) only here. */
  supportsOptions: boolean;
  /** `min_value` / `max_value` are meaningful only here. */
  supportsBounds: boolean;
  /** The raw value is sent as a number rather than a string. */
  numeric: boolean;
}

const SPECS: Record<RequestFieldType, RequestFieldTypeSpec> = {
  text: { type: 'text', control: 'text', supportsOptions: false, supportsBounds: false, numeric: false },
  number: { type: 'number', control: 'number', supportsOptions: false, supportsBounds: true, numeric: true },
  count: { type: 'count', control: 'stepper', supportsOptions: false, supportsBounds: true, numeric: true },
  date: { type: 'date', control: 'date', supportsOptions: false, supportsBounds: false, numeric: false },
  time: { type: 'time', control: 'time', supportsOptions: false, supportsBounds: false, numeric: false },
  select: { type: 'select', control: 'select', supportsOptions: true, supportsBounds: false, numeric: false },
};

export const REQUEST_FIELD_TYPES: RequestFieldType[] = [
  'text',
  'number',
  'count',
  'date',
  'time',
  'select',
];

export function isRequestFieldType(value: unknown): value is RequestFieldType {
  return typeof value === 'string' && value in SPECS;
}

export function fieldSpec(type: string | null | undefined): RequestFieldTypeSpec {
  return isRequestFieldType(type) ? SPECS[type] : SPECS.text;
}

/** The subset of a field a validator needs — shared by the CMS and the storefront. */
export interface RequestFieldRules {
  field_type: string;
  is_required: boolean;
  min_value?: number | null;
  max_value?: number | null;
  options?: { value: string }[];
}

export interface FieldValidationError {
  /** i18n key. */
  key: string;
  params?: Record<string, string | number>;
}

/** Value as held by the form draft: always a string, converted on submit. */
export type RawFieldValue = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

/**
 * Mirrors the server checks (`field_required`, `field_invalid`) so the guest
 * sees the problem while typing. The server stays the source of truth.
 */
export function validateFieldValue(
  field: RequestFieldRules,
  raw: RawFieldValue,
): FieldValidationError | null {
  const spec = fieldSpec(field.field_type);
  const value = raw.trim();

  if (!value) {
    return field.is_required ? { key: 'guest.request.errors.required' } : null;
  }

  if (spec.numeric) {
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed)) return { key: 'guest.request.errors.number' };
    if (spec.type === 'count' && !Number.isInteger(parsed)) {
      return { key: 'guest.request.errors.integer' };
    }
    if (typeof field.min_value === 'number' && parsed < field.min_value) {
      return { key: 'guest.request.errors.min', params: { min: field.min_value } };
    }
    if (typeof field.max_value === 'number' && parsed > field.max_value) {
      return { key: 'guest.request.errors.max', params: { max: field.max_value } };
    }
    return null;
  }

  if (spec.type === 'date' && !DATE_RE.test(value)) {
    return { key: 'guest.request.errors.date' };
  }
  if (spec.type === 'time' && !TIME_RE.test(value)) {
    return { key: 'guest.request.errors.time' };
  }
  if (spec.type === 'select') {
    const known = (field.options ?? []).some((option) => option.value === value);
    if (!known) return { key: 'guest.request.errors.option' };
  }
  return null;
}

/** Draft string → what goes into `field_values` of the order payload. */
export function serializeFieldValue(
  field: RequestFieldRules,
  raw: RawFieldValue,
): string | number {
  const value = raw.trim();
  if (fieldSpec(field.field_type).numeric) return Number(value.replace(',', '.'));
  return value;
}

/** Seed of a fresh form: a count starts at its minimum, everything else empty. */
export function seedFieldValue(field: RequestFieldRules): RawFieldValue {
  if (fieldSpec(field.field_type).control !== 'stepper') return '';
  return String(typeof field.min_value === 'number' ? field.min_value : 1);
}
