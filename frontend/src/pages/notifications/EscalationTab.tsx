import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { ApiError } from '@/api/client';
import {
  createEscalationRule,
  deleteEscalationRule,
  fetchEscalationRules,
  fetchNotificationChannels,
  updateEscalationRule,
} from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';
import type { EscalationRule } from '@/api/notificationTypes';
import type { Bootstrap } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';
import type { ContentLanguages } from '@/hooks/useBootstrap';
import {
  emptyRule,
  rulePayload,
  ruleToDraft,
  serverErrorTarget,
  validateRule,
  type RuleDraft,
} from '@/notifications/escalation';
import { useDraftState } from '@/state/useDraftState';
import { pickTranslated } from '@/utils/translated';
import { EscalationStepsEditor } from './EscalationStepsEditor';

export interface EscalationTabProps {
  bootstrap: Bootstrap | undefined;
  languages: ContentLanguages;
}

const NEW_RULE = 'new';

export function EscalationTab({ bootstrap, languages }: EscalationTabProps) {
  const { t } = useTranslation();

  const rulesQuery = useQuery({
    queryKey: queryKeys.escalationRules,
    queryFn: fetchEscalationRules,
  });

  const [selectedId, setSelectedId] = useState<string>(NEW_RULE);

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);

  // Land on the first existing rule once the list arrives; a hotel that has
  // none starts on a blank one.
  useEffect(() => {
    if (selectedId !== NEW_RULE && rules.some((rule) => rule.id === selectedId)) return;
    if (selectedId === NEW_RULE && rules.length === 0) return;
    setSelectedId(rules.length ? rules[0].id : NEW_RULE);
  }, [rules, selectedId]);

  if (rulesQuery.isLoading) {
    return (
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack spacing={1}>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} variant="rounded" height={64} />
            ))}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (rulesQuery.isError) {
    return <Alert severity="error">{t('notifications.escalation.loadError')}</Alert>;
  }

  const selected = rules.find((rule) => rule.id === selectedId) ?? null;

  return (
    <RuleEditor
      key={selected?.id ?? NEW_RULE}
      rule={selected}
      rules={rules}
      selectedId={selectedId}
      onSelect={setSelectedId}
      bootstrap={bootstrap}
      languages={languages}
    />
  );
}

interface RuleEditorProps {
  rule: EscalationRule | null;
  rules: EscalationRule[];
  selectedId: string;
  onSelect: (id: string) => void;
  bootstrap: Bootstrap | undefined;
  languages: ContentLanguages;
}

function RuleEditor({
  rule,
  rules,
  selectedId,
  onSelect,
  bootstrap,
  languages,
}: RuleEditorProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const identity = rule?.id ?? NEW_RULE;
  const [draft, setDraft] = useDraftState<RuleDraft>(
    () => (rule ? ruleToDraft(rule) : emptyRule()),
    identity,
  );
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const channelsQuery = useQuery({
    queryKey: queryKeys.notificationChannels,
    queryFn: fetchNotificationChannels,
  });

  const errors = useMemo(() => {
    const local: Record<string, string> = {};
    if (touched) {
      for (const error of validateRule(draft)) local[error.target] = t(error.messageKey);
    }
    return { ...local, ...serverErrors };
  }, [draft, serverErrors, t, touched]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.escalationRules });

  const saveMutation = useMutation({
    mutationFn: (value: RuleDraft) =>
      value.id
        ? updateEscalationRule(value.id, rulePayload(value))
        : createEscalationRule(rulePayload(value)),
    onSuccess: (saved) => {
      toast.show(t('notifications.escalation.saved'), 'success');
      setServerErrors({});
      void invalidate();
      onSelect(saved.id);
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.isValidation || error.status === 409)) {
        // Every documented code lands on the same control the local check uses.
        setServerErrors({ [serverErrorTarget(error.code, draft)]: error.detail });
        return;
      }
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEscalationRule(id),
    onSuccess: () => {
      toast.show(t('notifications.escalation.deleted'), 'success');
      setConfirmDelete(false);
      onSelect(NEW_RULE);
      void invalidate();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  const handleSave = () => {
    setTouched(true);
    setServerErrors({});
    if (validateRule(draft).length > 0) return;
    saveMutation.mutate(draft);
  };

  const pointTitle = (id: string | null | undefined) => {
    if (!id) return t('notifications.escalation.hotelWide');
    const point = bootstrap?.execution_points.find((entry) => entry.id === id);
    return point
      ? pickTranslated(point.title, languages.displayLanguage, languages.defaultCode) || point.code
      : id;
  };

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack>
            <Typography variant="h6">{t('notifications.escalation.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('notifications.escalation.hint')}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => onSelect(NEW_RULE)}
              data-testid="cms-escalation-new"
            >
              {t('notifications.escalation.newRule')}
            </Button>
            {draft.id ? (
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => setConfirmDelete(true)}
                data-testid="cms-escalation-delete"
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </Stack>
        </Stack>
        <Divider sx={{ mb: 2 }} />

        <Stack spacing={2.5}>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="flex-start">
            <TextField
              select
              size="small"
              label={t('notifications.escalation.rule')}
              value={selectedId}
              onChange={(event) => onSelect(event.target.value)}
              sx={{ minWidth: 260 }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'cms-escalation-rule-select' }}
            >
              {rules.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name || pointTitle(entry.execution_point_id)}
                </option>
              ))}
              <option value={NEW_RULE}>{t('notifications.escalation.newRule')}</option>
            </TextField>

            <TextField
              size="small"
              label={t('notifications.escalation.name')}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              sx={{ minWidth: 260, flexGrow: 1 }}
              inputProps={{ 'data-testid': 'cms-escalation-name', maxLength: 120 }}
            />

            <TextField
              select
              size="small"
              label={t('notifications.escalation.point')}
              value={draft.execution_point_id ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, execution_point_id: event.target.value || null })
              }
              error={Boolean(errors.execution_point_id)}
              helperText={errors.execution_point_id ?? t('notifications.escalation.pointHint')}
              sx={{ minWidth: 240 }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'cms-escalation-point' }}
            >
              <option value="">{t('notifications.escalation.hotelWide')}</option>
              {(bootstrap?.execution_points ?? []).map((point) => (
                <option key={point.id} value={point.id}>
                  {pickTranslated(point.title, languages.displayLanguage, languages.defaultCode) ||
                    point.code}
                </option>
              ))}
            </TextField>

            <FormControlLabel
              control={
                <Switch
                  checked={draft.is_active}
                  onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
                  inputProps={
                    { 'data-testid': 'cms-escalation-active' } as unknown as Record<string, string>
                  }
                />
              }
              label={t('notifications.escalation.active')}
            />
          </Stack>

          <Divider />

          <EscalationStepsEditor
            steps={draft.steps}
            onChange={(steps) => setDraft({ ...draft, steps })}
            channels={channelsQuery.data ?? []}
            errors={errors}
            disabled={saveMutation.isPending}
          />

          <Box>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="cms-escalation-save"
            >
              {t('common.save')}
            </Button>
          </Box>
        </Stack>
      </CardContent>

      <ConfirmDialog
        open={confirmDelete}
        testId="cms-escalation-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('notifications.escalation.deleteTitle')}
        description={t('notifications.escalation.deleteBody', { name: draft.name })}
        confirmLabel={t('common.delete')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => draft.id && deleteMutation.mutate(draft.id)}
      />
    </Card>
  );
}
