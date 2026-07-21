/**
 * Status colors come from the server as a TOKEN NAME (`color_token` on the
 * status object), never as a literal color: the project rule is that no color
 * value lives outside `src/theme/tokens.ts`.
 *
 * Here the token is mapped onto a theme palette slot, and components render
 * `${slot}.main` — so a hotel's brand override changes the board for free.
 */

export type StatusPaletteSlot = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';

const TOKEN_SLOTS: Record<string, StatusPaletteSlot> = {
  primary: 'primary',
  brand: 'primary',
  accent: 'secondary',
  secondary: 'secondary',
  success: 'success',
  done: 'success',
  positive: 'success',
  warning: 'warning',
  attention: 'warning',
  pending: 'warning',
  error: 'error',
  danger: 'error',
  critical: 'error',
  cancelled: 'error',
  canceled: 'error',
  info: 'info',
  neutral: 'info',
  muted: 'info',
};

/**
 * `"status.warning"`, `"WARNING"`, `"warning"` → `warning`.
 * Unknown tokens fall back to the brand color rather than to a raw literal.
 */
export function statusSlot(colorToken?: string | null): StatusPaletteSlot {
  if (!colorToken) return 'primary';
  const normalized = colorToken.toLowerCase().split(/[.\-_/]/).filter(Boolean).pop() ?? '';
  return TOKEN_SLOTS[normalized] ?? 'primary';
}

/** Theme path for a status color, e.g. `warning.main`. */
export function statusColorPath(colorToken?: string | null, shade: 'main' | 'light' | 'dark' = 'main') {
  return `${statusSlot(colorToken)}.${shade}`;
}
