/** Brand settings endpoints — see docs/brand-api-contract.md. */
import type { DefaultMode, PartialBrandTokens } from '@/theme/tokens';
import { api } from './client';

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
