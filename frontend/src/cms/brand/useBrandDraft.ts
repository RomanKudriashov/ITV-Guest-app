import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queryKeys';
import {
  fetchAbstractions,
  fetchBrand,
  fetchFonts,
  fetchPresets,
  patchBrand,
  type BrandPreset,
  type BrandRecord,
} from '@/api/brand';
import { useDraftState } from '@/state/useDraftState';
import {
  mergeBrandTokens,
  type BrandColorSet,
  type PartialBrandExtras,
  type PartialBrandTokens,
  type ThemeMode,
} from '@/theme/tokens';
import type { BrandBackground, BrandShapeTokens, BrandTypographyTokens } from '@/theme/tokens';

/** Order-independent structural equality for the plain token objects. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (val as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return val;
  });
}

export function useBrandDraft() {
  const queryClient = useQueryClient();

  const brandQuery = useQuery({ queryKey: queryKeys.brand, queryFn: fetchBrand });
  const presetsQuery = useQuery({ queryKey: queryKeys.brandPresets, queryFn: fetchPresets });
  const fontsQuery = useQuery({ queryKey: queryKeys.brandFonts, queryFn: fetchFonts });
  const abstractionsQuery = useQuery({
    queryKey: queryKeys.brandAbstractions,
    queryFn: fetchAbstractions,
  });

  const record = brandQuery.data;
  // Identity re-seeds the draft only when the SERVER record genuinely changes
  // (id or updated_at). A background refetch of the same record leaves unsaved
  // edits untouched — the one draft rule of the app.
  const identity = record ? `${record.id}:${record.updated_at}` : 'none';

  const [draft, setDraft, resetDraft] = useDraftState<PartialBrandTokens>(
    () => record?.tokens ?? {},
    identity,
  );

  const merged = useMemo(() => mergeBrandTokens(draft), [draft]);
  const dirty = useMemo(
    () => stableStringify(draft) !== stableStringify(record?.tokens ?? {}),
    [draft, record],
  );

  /** A manual edit always makes the set `custom` — it is no longer a clean preset. */
  const setField = useCallback(
    (producer: (prev: PartialBrandTokens) => PartialBrandTokens) => {
      setDraft((prev) => ({ ...producer(prev), preset: 'custom' }));
    },
    [setDraft],
  );

  const setColor = useCallback(
    (mode: ThemeMode, key: keyof BrandColorSet, value: string) => {
      setField((prev) => ({
        ...prev,
        palette: {
          ...prev.palette,
          [mode]: { ...prev.palette?.[mode], [key]: value },
        },
      }));
    },
    [setField],
  );

  /** The accent (secondary) is one brand color — written to both modes at once. */
  const setAccent = useCallback(
    (value: string) => {
      setField((prev) => ({
        ...prev,
        palette: {
          ...prev.palette,
          light: { ...prev.palette?.light, secondary: value },
          dark: { ...prev.palette?.dark, secondary: value },
        },
      }));
    },
    [setField],
  );

  const setTypography = useCallback(
    (patch: Partial<BrandTypographyTokens>) => {
      setField((prev) => ({ ...prev, typography: { ...prev.typography, ...patch } }));
    },
    [setField],
  );

  const setShape = useCallback(
    (patch: Partial<BrandShapeTokens>) => {
      setField((prev) => ({ ...prev, shape: { ...prev.shape, ...patch } }));
    },
    [setField],
  );

  const setBrandExtras = useCallback(
    (patch: PartialBrandExtras) => {
      setField((prev) => ({ ...prev, brand: { ...prev.brand, ...patch } }));
    },
    [setField],
  );

  const setBackground = useCallback(
    (patch: Partial<BrandBackground>) => {
      setField((prev) => ({
        ...prev,
        brand: {
          ...prev.brand,
          background: {
            kind: patch.kind ?? prev.brand?.background?.kind ?? 'solid',
            ...prev.brand?.background,
            ...patch,
          },
        },
      }));
    },
    [setField],
  );

  /** Replace the whole draft with a preset's tokens — client-side only, unsaved. */
  const applyPreset = useCallback(
    (preset: BrandPreset) => {
      setDraft({ ...preset.tokens, preset: preset.code });
    },
    [setDraft],
  );

  const saveMutation = useMutation<BrandRecord, unknown, void>({
    mutationFn: () => patchBrand(draft),
    onSuccess: (rec) => {
      queryClient.setQueryData(queryKeys.brand, rec);
    },
  });

  return {
    record,
    draft,
    merged,
    dirty,
    presets: presetsQuery.data?.presets ?? [],
    fonts: fontsQuery.data?.fonts ?? [],
    abstractions: abstractionsQuery.data?.abstractions ?? [],
    isLoading: brandQuery.isLoading,
    loadError: brandQuery.error,
    isSaving: saveMutation.isPending,
    save: () => saveMutation.mutateAsync(),
    reset: resetDraft,
    setColor,
    setAccent,
    setTypography,
    setShape,
    setBrandExtras,
    setBackground,
    applyPreset,
  };
}

export type BrandDraft = ReturnType<typeof useBrandDraft>;
