import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { NotificationChannel } from '@/api/notificationTypes';
import {
  TARGET_KINDS,
  emptyStep,
  normalizeStep,
  parseDelay,
  targetSpec,
  type StepDraft,
  type TargetKind,
} from '@/notifications/escalation';

export interface EscalationStepsEditorProps {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
  channels: NotificationChannel[];
  /** `step:<key>:delay` / `step:<key>:channel` / `rule` → message. */
  errors: Record<string, string>;
  disabled?: boolean;
}

/**
 * Constructor of escalation steps — the same shape of editor as
 * `RequestFieldsEditor`: drag-and-drop order, local drafts, one card per row.
 * Which inputs a row offers is decided by the target table, never by a chain of
 * `if (target_kind === 'channel')`.
 */
export function EscalationStepsEditor({
  steps,
  onChange,
  channels,
  errors,
  disabled = false,
}: EscalationStepsEditorProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const patchStep = (key: string, changes: Partial<StepDraft>) =>
    onChange(
      steps.map((step) => (step.key === key ? normalizeStep({ ...step, ...changes }) : step)),
    );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = steps.findIndex((step) => step.key === active.id);
    const to = steps.findIndex((step) => step.key === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(steps, from, to));
  };

  const addStep = () => {
    const last = steps.length ? parseDelay(steps[steps.length - 1].delayInput) : null;
    onChange([...steps, emptyStep(last === null ? 0 : last + 5)]);
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack>
          <Typography variant="subtitle1">{t('notifications.escalation.stepsTitle')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('notifications.escalation.stepsHint')}
          </Typography>
        </Stack>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={disabled}
          onClick={addStep}
          data-testid="cms-step-add"
        >
          {t('notifications.escalation.addStep')}
        </Button>
      </Stack>

      {/* The order at a glance: «сразу → через 5 мин → через 15 мин». */}
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        data-testid="cms-escalation-preview"
      >
        {steps.map((step, index) => (
          <Stack key={step.key} direction="row" spacing={0.5} alignItems="center">
            {index > 0 ? <ArrowForwardIcon fontSize="small" color="disabled" /> : null}
            <Chip size="small" label={delayLabel(step.delayInput, t)} />
          </Stack>
        ))}
      </Stack>

      {errors.rule ? (
        <Typography variant="body2" color="error" data-testid="cms-escalation-rule-error">
          {errors.rule}
        </Typography>
      ) : null}

      {steps.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="cms-escalation-steps-empty">
          {t('notifications.escalation.noSteps')}
        </Typography>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={steps.map((step) => step.key)}
            strategy={verticalListSortingStrategy}
          >
            <Stack spacing={2} data-testid="cms-escalation-steps">
              {steps.map((step, index) => (
                <StepCard
                  key={step.key}
                  step={step}
                  index={index}
                  channels={channels}
                  errors={errors}
                  disabled={disabled}
                  onPatch={(changes) => patchStep(step.key, changes)}
                  onRemove={() => onChange(steps.filter((entry) => entry.key !== step.key))}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Stack>
  );
}

function delayLabel(delayInput: string, t: TFunction): string {
  const minutes = parseDelay(delayInput);
  if (minutes === null) return t('notifications.escalation.delayUnknown');
  return minutes === 0
    ? t('notifications.escalation.immediately')
    : t('notifications.escalation.afterMinutes', { minutes });
}

interface StepCardProps {
  step: StepDraft;
  index: number;
  channels: NotificationChannel[];
  errors: Record<string, string>;
  disabled: boolean;
  onPatch: (changes: Partial<StepDraft>) => void;
  onRemove: () => void;
}

function StepCard({ step, index, channels, errors, disabled, onPatch, onRemove }: StepCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.key,
  });

  const delayError = errors[`step:${step.key}:delay`];
  const channelError = errors[`step:${step.key}:channel`];
  const spec = targetSpec(step.target_kind);

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`cms-step-${index}`}
      sx={{ p: 2, borderColor: 'divider', opacity: isDragging ? 0.6 : 1 }}
    >
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            {...attributes}
            {...listeners}
            sx={{ display: 'flex', color: 'text.secondary', cursor: 'grab' }}
            aria-label={t('common.reorder')}
          >
            <DragIndicatorIcon fontSize="small" />
          </Box>
          <Chip size="small" label={t('notifications.escalation.stepN', { n: index + 1 })} />
          <Typography variant="caption" color="text.secondary">
            {delayLabel(step.delayInput, t)}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            size="small"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t('common.delete')}
            data-testid={`cms-step-remove-${index}`}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="flex-start">
          <TextField
            size="small"
            label={t('notifications.escalation.delay')}
            value={step.delayInput}
            onChange={(event) => onPatch({ delayInput: event.target.value })}
            error={Boolean(delayError)}
            helperText={delayError ?? t('notifications.escalation.delayHint')}
            sx={{ width: 220 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  {t('notifications.escalation.minutes')}
                </InputAdornment>
              ),
            }}
            inputProps={{ 'data-testid': `cms-step-delay-${index}`, inputMode: 'numeric' }}
          />

          <TextField
            select
            size="small"
            label={t('notifications.escalation.target')}
            value={step.target_kind}
            onChange={(event) => onPatch({ target_kind: event.target.value as TargetKind })}
            sx={{ minWidth: 220 }}
            SelectProps={{ native: true }}
            InputLabelProps={{ shrink: true }}
            helperText={t(`notifications.escalation.targetHint.${step.target_kind}`)}
            inputProps={{ 'data-testid': `cms-step-target-${index}` }}
          >
            {TARGET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`notifications.escalation.targets.${kind}`)}
              </option>
            ))}
          </TextField>

          {/* A channel picker exists only where the target table says so. */}
          {spec.requiresChannel ? (
            <TextField
              select
              size="small"
              label={t('notifications.escalation.channel')}
              value={step.channel_id ?? ''}
              onChange={(event) => onPatch({ channel_id: event.target.value || null })}
              error={Boolean(channelError)}
              helperText={channelError}
              sx={{ minWidth: 240 }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': `cms-step-channel-${index}` }}
            >
              <option value="">{t('common.none')}</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.title}
                </option>
              ))}
            </TextField>
          ) : null}

          <TextField
            size="small"
            label={t('notifications.escalation.stepTitle')}
            value={step.title}
            onChange={(event) => onPatch({ title: event.target.value })}
            sx={{ minWidth: 240, flexGrow: 1 }}
            inputProps={{ 'data-testid': `cms-step-title-${index}`, maxLength: 120 }}
          />
        </Stack>
      </Stack>
    </Paper>
  );
}
