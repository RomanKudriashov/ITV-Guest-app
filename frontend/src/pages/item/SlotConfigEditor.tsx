import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchSlotConfig, putSlotConfig } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { ExecutionPoint, Schedule, SlotConfig } from '@/api/types';
import { SchedulePicker } from '@/components/SchedulePicker';
import { useToast } from '@/components/ToastProvider';
import { pickTranslated } from '@/utils/translated';

export interface SlotConfigEditorProps {
  /** A slot config is a OneToOne to a SAVED item — null while the item is new. */
  itemId: string | null;
  schedules: Schedule[];
  executionPoints: ExecutionPoint[];
  dayParts: string[];
  displayLanguage: string;
  fallbackLanguage: string;
}

interface SlotForm {
  durationInput: string;
  capacityInput: string;
  scheduleId: string | null;
  executionPointId: string;
  leadInput: string;
  horizonInput: string;
}

const DEFAULT_FORM: SlotForm = {
  durationInput: '60',
  capacityInput: '1',
  scheduleId: null,
  executionPointId: '',
  leadInput: '0',
  horizonInput: '14',
};

function formFromConfig(config: SlotConfig): SlotForm {
  return {
    durationInput: String(config.duration_minutes ?? 60),
    capacityInput: String(config.capacity ?? 1),
    scheduleId: config.schedule_id ?? null,
    executionPointId: config.execution_point_id ?? '',
    leadInput: String(config.lead_minutes ?? 0),
    horizonInput: String(config.horizon_days ?? 14),
  };
}

/**
 * The body of the item editor for a `slot` offering: the recipe slots are built
 * from — duration, capacity, working hours and the fulfilling department. It is
 * self-contained (its own GET/PUT and Save) because a slot config is a OneToOne
 * to a SAVED item; a brand-new slot item must be created first, and until then
 * this section asks for that instead of guessing an item id.
 */
export function SlotConfigEditor({
  itemId,
  schedules,
  executionPoints,
  dayParts,
  displayLanguage,
  fallbackLanguage,
}: SlotConfigEditorProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<SlotForm>(DEFAULT_FORM);

  const configQuery = useQuery({
    queryKey: queryKeys.slotConfig(itemId ?? ''),
    queryFn: () => fetchSlotConfig(itemId as string),
    enabled: Boolean(itemId),
    // A slot item with no config yet answers 404 — that is an empty form, not an
    // error worth retrying.
    retry: false,
  });

  useEffect(() => {
    if (configQuery.data) setForm(formFromConfig(configQuery.data));
  }, [configQuery.data]);

  const duration = Number(form.durationInput);
  const capacity = Number(form.capacityInput);
  const lead = Number(form.leadInput);
  const horizon = Number(form.horizonInput);

  const errors = useMemo(() => {
    const problems: Partial<Record<keyof SlotForm, string>> = {};
    if (!Number.isFinite(duration) || duration < 5) {
      problems.durationInput = t('slotConfig.errors.duration');
    }
    if (!Number.isFinite(capacity) || capacity < 1) {
      problems.capacityInput = t('slotConfig.errors.capacity');
    }
    if (!form.scheduleId) problems.scheduleId = t('slotConfig.errors.schedule');
    if (!form.executionPointId) problems.executionPointId = t('slotConfig.errors.department');
    if (!Number.isFinite(lead) || lead < 0) problems.leadInput = t('slotConfig.errors.lead');
    if (!Number.isFinite(horizon) || horizon < 1) {
      problems.horizonInput = t('slotConfig.errors.horizon');
    }
    return problems;
  }, [duration, capacity, lead, horizon, form.scheduleId, form.executionPointId, t]);

  const isValid = Object.keys(errors).length === 0;

  const saveMutation = useMutation({
    mutationFn: () =>
      putSlotConfig(itemId as string, {
        duration_minutes: duration,
        capacity,
        schedule_id: form.scheduleId,
        execution_point_id: form.executionPointId,
        lead_minutes: lead,
        horizon_days: horizon,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.slotConfig(itemId as string), saved);
      toast.show(t('slotConfig.saved'), 'success');
    },
    onError: (error) => {
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  if (!itemId) {
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle1">{t('slotConfig.section')}</Typography>
        <Alert severity="info" data-testid="cms-slot-needs-save">
          {t('slotConfig.saveItemFirst')}
        </Alert>
      </Stack>
    );
  }

  if (configQuery.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 3 }}>
        <CircularProgress size={24} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5} data-testid="cms-slot-config">
      <Typography variant="subtitle1">{t('slotConfig.section')}</Typography>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          type="number"
          label={t('slotConfig.duration')}
          value={form.durationInput}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, durationInput: event.target.value }))
          }
          error={Boolean(errors.durationInput)}
          helperText={errors.durationInput ?? t('slotConfig.durationHint')}
          sx={{ width: 200 }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">{t('slotConfig.minutes')}</InputAdornment>
            ),
          }}
          inputProps={{ min: 5, step: 5, 'data-testid': 'cms-slot-duration' }}
        />
        <TextField
          size="small"
          type="number"
          label={t('slotConfig.capacity')}
          value={form.capacityInput}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, capacityInput: event.target.value }))
          }
          error={Boolean(errors.capacityInput)}
          helperText={errors.capacityInput ?? t('slotConfig.capacityHint')}
          sx={{ width: 200 }}
          inputProps={{ min: 1, step: 1, 'data-testid': 'cms-slot-capacity' }}
        />
      </Stack>

      <Box>
        <Typography variant="caption" color="text.secondary">
          {t('slotConfig.schedule')}
        </Typography>
        <SchedulePicker
          value={form.scheduleId}
          onChange={(scheduleId) => setForm((prev) => ({ ...prev, scheduleId }))}
          schedules={schedules}
          dayParts={dayParts}
          label={t('slotConfig.schedule')}
          testId="cms-slot-schedule"
        />
        {errors.scheduleId ? (
          <Typography variant="caption" color="error.main">
            {errors.scheduleId}
          </Typography>
        ) : null}
      </Box>

      <TextField
        select
        size="small"
        label={t('slotConfig.department')}
        value={form.executionPointId}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, executionPointId: event.target.value }))
        }
        error={Boolean(errors.executionPointId)}
        helperText={errors.executionPointId ?? t('slotConfig.departmentHint')}
        sx={{ maxWidth: 320 }}
        SelectProps={{ native: true }}
        InputLabelProps={{ shrink: true }}
        inputProps={{ 'data-testid': 'cms-slot-department' }}
      >
        <option value="">{t('slotConfig.departmentPlaceholder')}</option>
        {executionPoints.map((point) => (
          <option key={point.id} value={point.id}>
            {pickTranslated(point.title, displayLanguage, fallbackLanguage) || point.code}
          </option>
        ))}
      </TextField>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          type="number"
          label={t('slotConfig.lead')}
          value={form.leadInput}
          onChange={(event) => setForm((prev) => ({ ...prev, leadInput: event.target.value }))}
          error={Boolean(errors.leadInput)}
          helperText={errors.leadInput ?? t('slotConfig.leadHint')}
          sx={{ width: 200 }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">{t('slotConfig.minutes')}</InputAdornment>
            ),
          }}
          inputProps={{ min: 0, step: 5, 'data-testid': 'cms-slot-lead' }}
        />
        <TextField
          size="small"
          type="number"
          label={t('slotConfig.horizon')}
          value={form.horizonInput}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, horizonInput: event.target.value }))
          }
          error={Boolean(errors.horizonInput)}
          helperText={errors.horizonInput ?? t('slotConfig.horizonHint')}
          sx={{ width: 200 }}
          InputProps={{
            endAdornment: <InputAdornment position="end">{t('slotConfig.days')}</InputAdornment>,
          }}
          inputProps={{ min: 1, step: 1, 'data-testid': 'cms-slot-horizon' }}
        />
      </Stack>

      <Box>
        <Button
          variant="contained"
          disabled={!isValid || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="cms-slot-save"
          startIcon={
            saveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {t('slotConfig.save')}
        </Button>
      </Box>
    </Stack>
  );
}
