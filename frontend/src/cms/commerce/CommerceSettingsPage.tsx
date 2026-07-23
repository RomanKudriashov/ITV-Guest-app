import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';

import { ApiError } from '@/api/client';
import { fetchCommerceSettings, updateCommerceSettings } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { CommerceSettings, CommerceSettingsPayload } from '@/api/types';
import { useToast } from '@/components/ToastProvider';
import { useAnalyticsLanguage } from '@/cms/analytics/format';
import { currencySymbol, inputToMinor, minorToInput } from '@/utils/money';

/** Basis points → percent string for display (1000 → "10"). */
function bpToPercent(bp: number): string {
  return String(Math.round(bp) / 100);
}

/** Percent input → basis points; `null` when the text is not a valid number. */
function percentToBp(value: string): number | null {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  if (!/^\d*\.?\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

const MAX_BP = 10_000;
const MAX_TIP = 100;

interface CommerceForm {
  serviceFeePercent: string;
  taxPercent: string;
  taxInclusive: boolean;
  tipPresets: number[];
  freeDeliveryInput: string;
  priceRoundInput: string;
}

function formFromSettings(settings: CommerceSettings): CommerceForm {
  return {
    serviceFeePercent: bpToPercent(settings.service_fee_bp),
    taxPercent: bpToPercent(settings.tax_bp),
    taxInclusive: settings.tax_inclusive,
    tipPresets: [...settings.tip_presets],
    freeDeliveryInput:
      settings.free_delivery_threshold_minor === null
        ? ''
        : minorToInput(settings.free_delivery_threshold_minor, settings.currency_minor_units),
    priceRoundInput: String(settings.price_round_to_minor),
  };
}

export function CommerceSettingsPage() {
  const { t } = useTranslation();
  const language = useAnalyticsLanguage();
  const queryClient = useQueryClient();
  const toast = useToast();

  const settingsQuery = useQuery({
    queryKey: queryKeys.commerceSettings,
    queryFn: fetchCommerceSettings,
  });
  const settings = settingsQuery.data;

  const [form, setForm] = useState<CommerceForm | null>(null);
  const [tipDraft, setTipDraft] = useState('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) setForm(formFromSettings(settings));
  }, [settings]);

  const minorUnits = settings?.currency_minor_units ?? 2;
  const currency = settings ? currencySymbol(settings.currency, language) : '';

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form) return errors;
    const feeBp = percentToBp(form.serviceFeePercent);
    if (feeBp === null || feeBp < 0 || feeBp > MAX_BP) {
      errors.service_fee_bp = t('commerce.errors.percentRange');
    }
    const taxBp = percentToBp(form.taxPercent);
    if (taxBp === null || taxBp < 0 || taxBp > MAX_BP) {
      errors.tax_bp = t('commerce.errors.percentRange');
    }
    if (form.freeDeliveryInput.trim()) {
      const minor = inputToMinor(form.freeDeliveryInput, minorUnits);
      if (minor === null || minor < 0) errors.free_delivery_threshold_minor = t('commerce.errors.moneyInvalid');
    }
    const round = Number(form.priceRoundInput);
    if (!form.priceRoundInput.trim() || !Number.isInteger(round) || round < 0) {
      errors.price_round_to_minor = t('commerce.errors.nonNegativeInt');
    }
    return errors;
  }, [form, minorUnits, t]);

  const clientValid = Object.keys(fieldErrors).length === 0;
  const errors = { ...fieldErrors, ...serverErrors };

  const changedPayload = useMemo((): CommerceSettingsPayload => {
    if (!form || !settings) return {};
    const payload: CommerceSettingsPayload = {};
    const feeBp = percentToBp(form.serviceFeePercent);
    if (feeBp !== null && feeBp !== settings.service_fee_bp) payload.service_fee_bp = feeBp;
    const taxBp = percentToBp(form.taxPercent);
    if (taxBp !== null && taxBp !== settings.tax_bp) payload.tax_bp = taxBp;
    if (form.taxInclusive !== settings.tax_inclusive) payload.tax_inclusive = form.taxInclusive;
    const sameTips =
      form.tipPresets.length === settings.tip_presets.length &&
      form.tipPresets.every((value, index) => value === settings.tip_presets[index]);
    if (!sameTips) payload.tip_presets = form.tipPresets;
    const threshold = form.freeDeliveryInput.trim()
      ? inputToMinor(form.freeDeliveryInput, minorUnits)
      : null;
    if (threshold !== settings.free_delivery_threshold_minor) {
      payload.free_delivery_threshold_minor = threshold;
    }
    const round = Number(form.priceRoundInput);
    if (Number.isInteger(round) && round !== settings.price_round_to_minor) {
      payload.price_round_to_minor = round;
    }
    return payload;
  }, [form, settings, minorUnits]);

  const isDirty = Object.keys(changedPayload).length > 0;

  const saveMutation = useMutation({
    mutationFn: () => updateCommerceSettings(changedPayload),
    onSuccess: (saved) => {
      setServerErrors({});
      setForm(formFromSettings(saved));
      queryClient.setQueryData(queryKeys.commerceSettings, saved);
      toast.show(t('commerce.saved'), 'success');
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'out_of_range' && error.field) {
        setServerErrors({ [error.field]: error.detail });
        toast.show(error.detail, 'error');
        return;
      }
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  if (settingsQuery.isLoading || !form) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={420} />
      </Box>
    );
  }

  if (settingsQuery.isError || !settings) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('commerce.loadError')}</Alert>
      </Box>
    );
  }

  const patch = (changes: Partial<CommerceForm>) => {
    setForm((prev) => (prev ? { ...prev, ...changes } : prev));
    setServerErrors({});
  };

  const addTip = () => {
    const parsed = Number(tipDraft.replace(',', '.'));
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TIP) return;
    if (form.tipPresets.includes(parsed)) {
      setTipDraft('');
      return;
    }
    patch({ tipPresets: [...form.tipPresets, parsed].sort((a, b) => a - b) });
    setTipDraft('');
  };

  const removeTip = (percent: number) =>
    patch({ tipPresets: form.tipPresets.filter((value) => value !== percent) });

  return (
    <Box sx={{ p: 3, pb: 10 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5">{t('commerce.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('commerce.subtitle')}
          </Typography>
        </Stack>
        <Button
          variant="contained"
          disabled={!clientValid || !isDirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="cms-commerce-save"
          startIcon={
            saveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {t('common.save')}
        </Button>
      </Stack>

      <Card variant="outlined" sx={{ maxWidth: 720, borderColor: 'divider' }}>
        <CardContent>
          <Stack spacing={3}>
            {/* Fees & tax */}
            <Stack spacing={2}>
              <Typography variant="subtitle1">{t('commerce.feesSection')}</Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <TextField
                  size="small"
                  label={t('commerce.serviceFee')}
                  value={form.serviceFeePercent}
                  onChange={(event) => patch({ serviceFeePercent: event.target.value })}
                  error={Boolean(errors.service_fee_bp)}
                  helperText={errors.service_fee_bp ?? t('commerce.percentHint')}
                  sx={{ width: 220 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                  inputProps={{ 'data-testid': 'cms-commerce-service-fee', inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  label={t('commerce.tax')}
                  value={form.taxPercent}
                  onChange={(event) => patch({ taxPercent: event.target.value })}
                  error={Boolean(errors.tax_bp)}
                  helperText={errors.tax_bp ?? t('commerce.percentHint')}
                  sx={{ width: 220 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                  inputProps={{ 'data-testid': 'cms-commerce-tax', inputMode: 'decimal' }}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.taxInclusive}
                    onChange={(event) => patch({ taxInclusive: event.target.checked })}
                    inputProps={
                      { 'data-testid': 'cms-commerce-tax-inclusive' } as Record<string, string>
                    }
                  />
                }
                label={form.taxInclusive ? t('commerce.taxInclusive') : t('commerce.taxExclusive')}
              />
            </Stack>

            <Divider />

            {/* Tips */}
            <Stack spacing={1.5}>
              <Typography variant="subtitle1">{t('commerce.tipsSection')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('commerce.tipsHint')}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                {form.tipPresets.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('commerce.noTips')}
                  </Typography>
                ) : (
                  form.tipPresets.map((percent) => (
                    <Chip
                      key={percent}
                      label={`${percent}%`}
                      onDelete={() => removeTip(percent)}
                      data-testid={`cms-commerce-tip-${percent}`}
                    />
                  ))
                )}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <TextField
                  size="small"
                  label={t('commerce.addTip')}
                  value={tipDraft}
                  onChange={(event) => setTipDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTip();
                    }
                  }}
                  sx={{ width: 160 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                  inputProps={{ 'data-testid': 'cms-commerce-tip-input', inputMode: 'numeric' }}
                />
                <Button
                  startIcon={<AddIcon />}
                  onClick={addTip}
                  sx={{ mt: 0.5 }}
                  data-testid="cms-commerce-tip-add"
                >
                  {t('common.add')}
                </Button>
              </Stack>
            </Stack>

            <Divider />

            {/* Delivery & rounding */}
            <Stack spacing={2}>
              <Typography variant="subtitle1">{t('commerce.deliverySection')}</Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <TextField
                  size="small"
                  label={t('commerce.freeDelivery')}
                  value={form.freeDeliveryInput}
                  onChange={(event) => patch({ freeDeliveryInput: event.target.value })}
                  error={Boolean(errors.free_delivery_threshold_minor)}
                  helperText={
                    errors.free_delivery_threshold_minor ?? t('commerce.freeDeliveryHint')
                  }
                  sx={{ width: 260 }}
                  InputProps={{
                    endAdornment: <InputAdornment position="end">{currency}</InputAdornment>,
                  }}
                  inputProps={{ 'data-testid': 'cms-commerce-free-delivery', inputMode: 'decimal' }}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t('commerce.priceRound')}
                  value={form.priceRoundInput}
                  onChange={(event) => patch({ priceRoundInput: event.target.value })}
                  error={Boolean(errors.price_round_to_minor)}
                  helperText={errors.price_round_to_minor ?? t('commerce.priceRoundHint')}
                  sx={{ width: 220 }}
                  inputProps={{ 'data-testid': 'cms-commerce-round', min: 0, step: 1 }}
                />
              </Stack>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
