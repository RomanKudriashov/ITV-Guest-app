/** Brand settings endpoints — see docs/brand-api-contract.md. */
import type { DefaultMode, PartialBrandTokens } from '@/theme/tokens';
import { api, request } from './client';

export interface BrandRecord {
  id: string;
  name: string;
  /** Applied preset code, or `custom`. */
  preset: string;
  /** Stored token override (deep-partial, merged over the platform defaults). */
  tokens: PartialBrandTokens;
  updated_at: string;
}

export interface BrandPreset {
  code: string;
  name: string;
  description?: string;
  /** Colors shown on the selection tile. */
  swatch: string[];
  default_mode?: DefaultMode;
  /** Full token set the preset applies. */
  tokens: PartialBrandTokens;
}

export interface BrandAbstraction {
  code: string;
  name: string;
  preview_url: string;
}

export interface BrandFont {
  /** Exact string that goes into `typography.fontFamily`. */
  family: string;
  name: string;
  category: string;
}

export function fetchBrand(): Promise<BrandRecord> {
  return api.get<BrandRecord>('/cms/brand');
}

/** Partial token patch — deep-merged on the server over the current set. */
export function patchBrand(tokens: PartialBrandTokens): Promise<BrandRecord> {
  return api.patch<BrandRecord>('/cms/brand', { tokens });
}

/**
 * Данные одного экрана показа — в той же форме, в какой их получает гость.
 *
 * Ходит в ПАНЕЛЬНУЮ ручку, а не в гостевую: гостевая требует сессию, и заводить
 * её на каждый заход в оформление значило бы плодить гостей, которых не было.
 * Считают ответ те же сборщики, что отвечают витрине.
 */
export function fetchPreviewScreen(
  screen: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  return api.get<unknown>('/cms/brand/preview', { query: { screen, ...params } });
}

export function fetchPresets(): Promise<{ presets: BrandPreset[] }> {
  return api.get<{ presets: BrandPreset[] }>('/cms/brand/presets');
}

export function applyPreset(preset: string): Promise<BrandRecord> {
  return api.post<BrandRecord>('/cms/brand/apply-preset', { preset });
}

export function fetchAbstractions(): Promise<{ abstractions: BrandAbstraction[] }> {
  return api.get<{ abstractions: BrandAbstraction[] }>('/cms/brand/abstractions');
}

export function fetchFonts(): Promise<{ fonts: BrandFont[] }> {
  return api.get<{ fonts: BrandFont[] }>('/cms/brand/fonts');
}

export interface UploadedFont {
  assetId: string;
  name: string;
  family: string;
  url: string;
  format: string;
}

/**
 * Загрузка файла шрифта отеля.
 *
 * Токены НЕ трогает: загрузить и выбрать — разные решения оператора. Ответ
 * несёт готовую строку семейства, а положит её в тему редактор — когда
 * оператор этого захочет.
 */
export function uploadBrandFont(file: File): Promise<UploadedFont> {
  const form = new FormData();
  form.append('file', file);
  return request<UploadedFont>('/cms/brand/font', { method: 'POST', formData: form });
}

/* ── Черновики и версии ─────────────────────────────────────────────────── */

export interface BrandVersionRecord {
  id: string;
  kind: 'draft' | 'published';
  name: string;
  number: number | null;
  author: string;
  created_at: string;
  published_at: string | null;
  /** Публикация является откатом к этой версии. */
  restored_from: { id: string; number: number | null } | null;
  /** От какой опубликованной версии начат черновик. */
  base_version: { id: string; number: number | null } | null;
  /** Пока черновик правили, витрину опубликовал кто-то другой. */
  is_stale: boolean;
  tokens?: PartialBrandTokens;
}

export function fetchBrandDrafts(): Promise<{ drafts: BrandVersionRecord[] }> {
  return api.get<{ drafts: BrandVersionRecord[] }>('/cms/brand/drafts');
}

export function fetchBrandDraft(id: string): Promise<BrandVersionRecord> {
  return api.get<BrandVersionRecord>(`/cms/brand/drafts/${id}`);
}

export function createBrandDraft(
  name: string,
  tokens: PartialBrandTokens,
): Promise<BrandVersionRecord> {
  return api.post<BrandVersionRecord>('/cms/brand/drafts', { name, tokens });
}

export function updateBrandDraft(
  id: string,
  patch: { name?: string; tokens?: PartialBrandTokens },
): Promise<BrandVersionRecord> {
  return api.patch<BrandVersionRecord>(`/cms/brand/drafts/${id}`, patch);
}

export function deleteBrandDraft(id: string): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/cms/brand/drafts/${id}`);
}

/**
 * Опубликовать черновик.
 *
 * `confirmStale` — ОТДЕЛЬНОЕ осознанное подтверждение, а не значение по
 * умолчанию: устаревший черновик стирает чужую работу целиком.
 */
export function publishBrandDraft(id: string, confirmStale = false): Promise<BrandVersionRecord> {
  return api.post<BrandVersionRecord>(
    `/cms/brand/drafts/${id}/publish${confirmStale ? '?confirm_stale=true' : ''}`,
  );
}

export function fetchBrandVersions(): Promise<{ versions: BrandVersionRecord[] }> {
  return api.get<{ versions: BrandVersionRecord[] }>('/cms/brand/versions');
}

export function restoreBrandVersion(id: string): Promise<BrandVersionRecord> {
  return api.post<BrandVersionRecord>(`/cms/brand/versions/${id}/restore`);
}
