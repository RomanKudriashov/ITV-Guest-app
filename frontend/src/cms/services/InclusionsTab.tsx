import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';

import { SelectField } from '@/components/SelectField';
import { useActionFailed } from '@/hooks/useActionFailed';

import {
  createInclusion,
  deleteInclusion,
  fetchInclusions,
  fetchServices,
  updateInclusion,
} from './api';
import type { CmsService, Inclusion } from './api';

/**
 * «Включённый контент» — управляющий UI к модели включений R2.
 *
 * R2 сделал модель и осознанно отложил интерфейс: настраивать включения было
 * нечем, кроме API. Здесь тот же смысл выражен экраном, и выражен ЧЕСТНО —
 * каждое поле overlay соответствует полю модели:
 *
 *   scope        — включить источник целиком или выбранные разделы;
 *   markup       — наценка поверх цены источника (проценты или фикс);
 *   hidden_items — что из источника не показывать;
 *   schedule     — своё расписание блока (доступность = пересечение);
 *   executor     — кто готовит: источник или мы сами.
 *
 * Ключевое, что экран обязан объяснять: включение — ССЫЛКА, а не копия.
 * Правка в источнике видна здесь сразу, и «скрыть позицию» не удаляет её у
 * владельца.
 */
export function InclusionsTab({ service }: { service: CmsService }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const inclusions = useQuery({
    queryKey: ['cms', 'inclusions', service.id],
    queryFn: () => fetchInclusions(service.id),
  });
  const services = useQuery({ queryKey: ['cms', 'services'], queryFn: () => fetchServices() });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['cms', 'inclusions', service.id] });

  const add = useMutation({
    mutationFn: (sourceId: string) =>
      createInclusion(service.id, { source_service_id: sourceId }),
    onSuccess: invalidate,
  });

  const label = (value: Record<string, string> | undefined, fallback: string) =>
    value?.[i18n.resolvedLanguage ?? 'ru'] ?? value?.ru ?? fallback;

  // Себя включить нельзя (запрет на уровне модели R2) — и предлагать незачем.
  const candidates = (services.data ?? []).filter(
    (candidate) =>
      candidate.id !== service.id &&
      !(inclusions.data ?? []).some((inc) => inc.source_service_id === candidate.id),
  );

  return (
    <Stack spacing={2} data-testid="service-inclusions">
      <Alert severity="info">{t('inclusions.explainer')}</Alert>

      {(inclusions.data ?? []).map((inclusion) => (
        <InclusionCard
          key={inclusion.id}
          inclusion={inclusion}
          sourceName={label(
            (services.data ?? []).find((s) => s.id === inclusion.source_service_id)?.public_name,
            inclusion.source_service_code ?? '—',
          )}
          onChanged={invalidate}
        />
      ))}

      {!(inclusions.data ?? []).length ? (
        <Typography variant="body2" color="text.secondary">
          {t('inclusions.empty')}
        </Typography>
      ) : null}

      <Divider />

      {/* На узком — столбиком: поле в 260 и ошибка рядом не помещались в 390 (партия 55). */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', sm: 'center' }}
      >
        <SelectField
          // Поле — кнопка «добавить», а не хранимое значение: после добавления
          // источник уходит из кандидатов, ключ меняется, поле снова пустое.
          key={candidates.length}
          size="small"
          fullWidth={false}
          label={t('inclusions.addSource')}
          value=""
          sx={{ minWidth: { xs: 0, sm: 260 } }}
          onChange={(next) => next && add.mutate(next)}
          testId="inclusion-add-source"
          disabled={!candidates.length}
          options={candidates.map((candidate) => ({
            value: candidate.id,
            label: label(candidate.public_name, candidate.code),
          }))}
        />
        {add.error ? <Alert severity="error">{String(add.error)}</Alert> : null}
      </Stack>
    </Stack>
  );
}

function InclusionCard({
  inclusion,
  sourceName,
  onChanged,
}: {
  inclusion: Inclusion;
  sourceName: string;
  onChanged: () => void;
}) {
  const actionFailed = useActionFailed();
  const { t } = useTranslation();
  const [markup, setMarkup] = useState(String(inclusion.markup_value ?? 0));

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateInclusion>[1]) =>
      updateInclusion(inclusion.id, patch),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => deleteInclusion(inclusion.id),
    onSuccess: onChanged,
  
    // Отказ виден: молча съеденный 403 читается как успех.
    onError: actionFailed,
  });

  return (
    <Card variant="outlined" sx={{ p: 2 }} data-testid={`inclusion-${inclusion.id}`}>
      {/* Шапка карточки переносится: имя, охват, «Активно» и «Удалить» в ряд
          шире 390 (партия 55). */}
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>
          {sourceName}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={t(`inclusions.scope.${inclusion.scope}`)}
        />
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={inclusion.is_active}
              onChange={(event) => save.mutate({ is_active: event.target.checked })}
              data-testid={`inclusion-active-${inclusion.id}`}
            />
          }
          label={t('inclusions.active')}
        />
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => remove.mutate()}
          data-testid={`inclusion-remove-${inclusion.id}`}
        >
          {t('common.delete')}
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <SelectField<Inclusion['scope']>
          size="small"
          fullWidth={false}
          label={t('inclusions.scopeLabel')}
          value={inclusion.scope}
          onChange={(next) => save.mutate({ scope: next })}
          sx={{ minWidth: 200 }}
          testId={`inclusion-scope-${inclusion.id}`}
          options={[
            { value: 'all', label: t('inclusions.scope.all') },
            { value: 'categories', label: t('inclusions.scope.categories') },
          ]}
        />

        <SelectField<Inclusion['markup_kind']>
          size="small"
          fullWidth={false}
          label={t('inclusions.markupKind')}
          value={inclusion.markup_kind}
          onChange={(next) => save.mutate({ markup_kind: next })}
          sx={{ minWidth: 180 }}
          testId={`inclusion-markup-kind-${inclusion.id}`}
          options={[
            { value: 'none', label: t('inclusions.markup.none') },
            { value: 'percent', label: t('inclusions.markup.percent') },
            { value: 'fixed', label: t('inclusions.markup.fixed') },
          ]}
        />

        {inclusion.markup_kind !== 'none' ? (
          <TextField
            size="small"
            label={t('inclusions.markupValue')}
            value={markup}
            onChange={(event) => setMarkup(event.target.value)}
            onBlur={() => save.mutate({ markup_value: Number(markup) || 0 })}
            sx={{ maxWidth: 200 }}
            data-testid={`inclusion-markup-value-${inclusion.id}`}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  {/* Проценты хранятся в базисных пунктах: 1500 = +15%. */}
                  {inclusion.markup_kind === 'percent' ? t('inclusions.bp') : '¤'}
                </InputAdornment>
              ),
            }}
          />
        ) : null}

        <SelectField<Inclusion['executor']>
          size="small"
          fullWidth={false}
          label={t('inclusions.executor')}
          value={inclusion.executor}
          onChange={(next) => save.mutate({ executor: next })}
          sx={{ minWidth: 220 }}
          testId={`inclusion-executor-${inclusion.id}`}
          helperText={t('inclusions.executorHint')}
          options={[
            { value: 'source', label: t('inclusions.executorSource') },
            { value: 'own', label: t('inclusions.executorOwn') },
          ]}
        />
      </Stack>

      {inclusion.hidden_item_ids.length ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {t('inclusions.hiddenCount', { count: inclusion.hidden_item_ids.length })}
        </Typography>
      ) : null}

      {save.error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {String(save.error)}
        </Alert>
      ) : null}
    </Card>
  );
}
