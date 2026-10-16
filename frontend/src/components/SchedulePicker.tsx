import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { ApiError } from '@/api/client';
import { createSchedule } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { Schedule, ScheduleInterval } from '@/api/types';
import { TimeField } from '@/components/DateField';
import { SelectField } from '@/components/SelectField';

const ALWAYS = '__always__';

export interface SchedulePickerProps {
  value: string | null;
  onChange: (scheduleId: string | null) => void;
  schedules: Schedule[];
  dayParts: string[];
  label?: string;
  testId?: string;
}

/**
 * Picks an existing schedule, "always available" (`schedule_id = null`), or
 * creates a new weekly schedule via `POST /cms/schedules`.
 */
export function SchedulePicker({
  value,
  onChange,
  schedules,
  dayParts,
  label,
  testId = 'schedule-picker',
}: SchedulePickerProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);

  // На узком экране — столбиком: в ряд с «Новое» поле выбора сжималось до
  // 42 px и «Всегда доступно» обрезалось. Поле всегда тянется на всю
  // оставшуюся ширину, а не по содержимому (партия 55).
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      alignItems={{ xs: 'stretch', sm: 'flex-start' }}
    >
      <SelectField
        size="small"
        label={label ?? t('schedule.label')}
        value={value ?? ALWAYS}
        onChange={(next) => onChange(next === ALWAYS || next === '' ? null : next)}
        helperText={t('schedule.helper')}
        testId={testId}
        sx={{ flex: 1, minWidth: 0 }}
        options={[
          { value: ALWAYS, label: t('schedule.always') },
          ...schedules.map((schedule) => ({
            value: schedule.id,
            label: schedule.is_always_open
              ? `${schedule.name} — ${t('schedule.alwaysOpen')}`
              : schedule.name,
          })),
        ]}
      />
      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={() => setDialogOpen(true)}
        data-testid={`${testId}-create`}
        sx={{ mt: { xs: 0, sm: 0.5 }, flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'auto' } }}
      >
        {t('schedule.create')}
      </Button>

      <ScheduleCreateDialog
        open={dialogOpen}
        dayParts={dayParts}
        onClose={() => setDialogOpen(false)}
        onCreated={(schedule) => {
          setDialogOpen(false);
          onChange(schedule.id);
        }}
      />
    </Stack>
  );
}

interface DraftInterval extends ScheduleInterval {
  key: string;
}

function emptyInterval(): DraftInterval {
  return {
    key: Math.random().toString(36).slice(2),
    weekday: 0,
    start_time: '08:00',
    end_time: '22:00',
    day_part: null,
  };
}

function ScheduleCreateDialog({
  open,
  dayParts,
  onClose,
  onCreated,
}: {
  open: boolean;
  dayParts: string[];
  onClose: () => void;
  onCreated: (schedule: Schedule) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [intervals, setIntervals] = useState<DraftInterval[]>([emptyInterval()]);
  const [error, setError] = useState<string | null>(null);

  const weekdays = t('schedule.weekdays', { returnObjects: true }) as unknown as string[];
  const weekdayLabels = Array.isArray(weekdays) ? weekdays : [];

  const mutation = useMutation({
    mutationFn: () =>
      createSchedule({
        name: name.trim(),
        is_always_open: alwaysOpen,
        intervals: alwaysOpen
          ? []
          : intervals.map(({ key: _key, ...interval }) => ({
              ...interval,
              day_part: interval.day_part || null,
            })),
      }),
    onSuccess: (schedule) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedules });
      setName('');
      setIntervals([emptyInterval()]);
      setError(null);
      onCreated(schedule);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError ? mutationError.detail : t('errors.generic'),
      );
    },
  });

  const invalid =
    !name.trim() ||
    (!alwaysOpen &&
      (intervals.length === 0 ||
        intervals.some(
          // Пустое время — недонабранное в TimeField: на сервер его не шлём.
          (interval) =>
            !interval.start_time ||
            !interval.end_time ||
            interval.start_time === interval.end_time,
        )));

  const patch = (key: string, changes: Partial<DraftInterval>) =>
    setIntervals((prev) =>
      prev.map((interval) => (interval.key === key ? { ...interval, ...changes } : interval)),
    );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="schedule-dialog">
      <DialogTitle>{t('schedule.createTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <TextField
            size="small"
            label={t('schedule.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            inputProps={{ 'data-testid': 'schedule-name' }}
            fullWidth
          />

          <FormControlLabel
            control={
              <Switch
                checked={alwaysOpen}
                onChange={(event) => setAlwaysOpen(event.target.checked)}
              />
            }
            label={t('schedule.alwaysOpen')}
          />

          {!alwaysOpen ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('schedule.intervals')}
              </Typography>
              {intervals.map((interval) => (
                /*
                  Интервал — сетка, а не ряд: пять полей в строку на 390 вылезали
                  за край. На узком: день на всю строку, «С»/«По» парой, часть
                  дня и удаление — следом (партия 55).
                */
                <Box
                  key={interval.key}
                  sx={{
                    display: 'grid',
                    gap: 1,
                    alignItems: 'center',
                    gridTemplateColumns: {
                      xs: '1fr 1fr',
                      // День — по самому длинному («Понедельник», «Воскресенье»): 132 px срезали 9 (партия 55).
                      sm: 'minmax(156px, 1.5fr) 1fr 1fr minmax(148px, 1.4fr) auto',
                    },
                  }}
                >
                  <SelectField
                    size="small"
                    label={t('schedule.weekday')}
                    value={String(interval.weekday)}
                    onChange={(next) => patch(interval.key, { weekday: Number(next) })}
                    sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, minWidth: 0 }}
                    options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({
                      value: String(day),
                      label: weekdayLabels[day] ?? String(day),
                    }))}
                  />
                  <TimeField
                    size="small"
                    fullWidth
                    label={t('schedule.from')}
                    value={interval.start_time}
                    onChange={(next) => patch(interval.key, { start_time: next })}
                  />
                  <TimeField
                    size="small"
                    fullWidth
                    label={t('schedule.to')}
                    value={interval.end_time}
                    onChange={(next) => patch(interval.key, { end_time: next })}
                  />
                  <SelectField
                    size="small"
                    label={t('schedule.dayPart')}
                    value={interval.day_part ?? ''}
                    onChange={(next) => patch(interval.key, { day_part: next || null })}
                    sx={{ minWidth: 0 }}
                    options={[
                      { value: '', label: t('common.none') },
                      ...dayParts.map((part) => ({
                        value: part,
                        label: t(`dayParts.${part}`, { defaultValue: part }),
                      })),
                    ]}
                  />
                  <IconButton
                    size="small"
                    onClick={() =>
                      setIntervals((prev) => prev.filter((entry) => entry.key !== interval.key))
                    }
                    aria-label={t('common.delete')}
                    sx={{ justifySelf: 'start' }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Box>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setIntervals((prev) => [...prev, emptyInterval()])}
                  data-testid="schedule-add-interval"
                >
                  {t('schedule.addInterval')}
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t('schedule.overnightHint')}
              </Typography>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={invalid || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="schedule-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
