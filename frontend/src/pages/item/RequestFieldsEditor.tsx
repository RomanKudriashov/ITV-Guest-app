import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
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

import { TranslatedField } from '@/components/TranslatedField';
import { REQUEST_FIELD_TYPES, fieldSpec, type RequestFieldType } from '@/offerings/requestFields';
import {
  emptyField,
  emptyFieldOption,
  normalizeField,
  type DraftField,
  type DraftFieldOption,
} from './requestFieldDrafts';

export interface RequestFieldsEditorProps {
  fields: DraftField[];
  onChange: (fields: DraftField[]) => void;
  languages: string[];
  languageLabels: Record<string, string>;
  defaultLanguage: string;
  /** `target -> field -> message`, produced by local + server validation. */
  errors: Record<string, Record<string, string>>;
  disabled?: boolean;
}

/**
 * Constructor of the request form — what modifier groups are for a dish. Which
 * inputs a row offers (bounds, options) is decided by the field-type table, so
 * this editor stays a layout and never grows a chain of `if (type === …)`.
 */
export function RequestFieldsEditor({
  fields,
  onChange,
  languages,
  languageLabels,
  defaultLanguage,
  errors,
  disabled = false,
}: RequestFieldsEditorProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const patchField = (key: string, changes: Partial<DraftField>) =>
    onChange(
      fields.map((field) =>
        field.key === key ? normalizeField({ ...field, ...changes }) : field,
      ),
    );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((field) => field.key === active.id);
    const to = fields.findIndex((field) => field.key === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(fields, from, to));
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack>
          <Typography variant="subtitle1">{t('requestFields.title')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('requestFields.hint')}
          </Typography>
        </Stack>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={disabled}
          data-testid="cms-request-field-add"
          onClick={() => onChange([...fields, emptyField()])}
        >
          {t('requestFields.addField')}
        </Button>
      </Stack>

      {fields.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="cms-request-fields-empty">
          {t('requestFields.empty')}
        </Typography>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={fields.map((field) => field.key)}
            strategy={verticalListSortingStrategy}
          >
            <Stack spacing={2} data-testid="cms-request-field-list">
              {fields.map((field, index) => (
                <FieldCard
                  key={field.key}
                  field={field}
                  index={index}
                  languages={languages}
                  languageLabels={languageLabels}
                  defaultLanguage={defaultLanguage}
                  errors={errors}
                  disabled={disabled}
                  onPatch={(changes) => patchField(field.key, changes)}
                  onRemove={() => onChange(fields.filter((entry) => entry.key !== field.key))}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Stack>
  );
}

interface FieldCardProps {
  field: DraftField;
  index: number;
  languages: string[];
  languageLabels: Record<string, string>;
  defaultLanguage: string;
  errors: Record<string, Record<string, string>>;
  disabled: boolean;
  onPatch: (changes: Partial<DraftField>) => void;
  onRemove: () => void;
}

function FieldCard({
  field,
  index,
  languages,
  languageLabels,
  defaultLanguage,
  errors,
  disabled,
  onPatch,
  onRemove,
}: FieldCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.key,
  });
  const fieldErrors = errors[`field:${field.key}`] ?? {};
  const spec = fieldSpec(field.field_type);

  const patchOption = (key: string, changes: Partial<DraftFieldOption>) =>
    onPatch({
      options: field.options.map((option) =>
        option.key === key ? { ...option, ...changes } : option,
      ),
    });

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`cms-request-field-${index}`}
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
          <Chip size="small" label={t('requestFields.fieldN', { n: index + 1 })} />
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            size="small"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t('common.delete')}
            data-testid={`cms-request-field-remove-${index}`}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>

        <TranslatedField
          label={t('requestFields.label')}
          value={field.label}
          onChange={(label) => onPatch({ label })}
          languages={languages}
          languageLabels={languageLabels}
          defaultLanguage={defaultLanguage}
          required
          error={fieldErrors.label}
          testId={`cms-request-field-label-${index}`}
        />

        <TranslatedField
          label={t('requestFields.helpText')}
          value={field.help_text}
          onChange={(help_text) => onPatch({ help_text })}
          languages={languages}
          languageLabels={languageLabels}
          defaultLanguage={defaultLanguage}
          testId={`cms-request-field-help-${index}`}
        />

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="flex-start">
          <TextField
            select
            size="small"
            label={t('requestFields.type')}
            value={field.field_type}
            onChange={(event) =>
              onPatch({ field_type: event.target.value as RequestFieldType })
            }
            sx={{ minWidth: 200 }}
            SelectProps={{ native: true }}
            InputLabelProps={{ shrink: true }}
            inputProps={{ 'data-testid': `cms-request-field-type-${index}` }}
          >
            {REQUEST_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`requestFields.types.${type}`)}
              </option>
            ))}
          </TextField>

          <TextField
            size="small"
            label={t('requestFields.code')}
            value={field.code}
            onChange={(event) => onPatch({ code: event.target.value })}
            error={Boolean(fieldErrors.code)}
            helperText={fieldErrors.code ?? t('requestFields.codeHint')}
            sx={{ width: 220 }}
            inputProps={{ 'data-testid': `cms-request-field-code-${index}`, maxLength: 40 }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={field.is_required}
                onChange={(event) => onPatch({ is_required: event.target.checked })}
                inputProps={
                  { 'data-testid': `cms-request-field-required-${index}` } as Record<
                    string,
                    string
                  >
                }
              />
            }
            label={t('requestFields.required')}
          />

          {/* Bounds exist only where the field-type table says they do. */}
          {spec.supportsBounds ? (
            <>
              <TextField
                size="small"
                label={t('requestFields.min')}
                value={field.minInput}
                onChange={(event) => onPatch({ minInput: event.target.value })}
                error={Boolean(fieldErrors.min_value)}
                helperText={fieldErrors.min_value ?? t('requestFields.boundHint')}
                sx={{ width: 140 }}
                inputProps={{
                  'data-testid': `cms-request-field-min-${index}`,
                  inputMode: 'decimal',
                }}
              />
              <TextField
                size="small"
                label={t('requestFields.max')}
                value={field.maxInput}
                onChange={(event) => onPatch({ maxInput: event.target.value })}
                error={Boolean(fieldErrors.max_value)}
                helperText={fieldErrors.max_value}
                sx={{ width: 140 }}
                inputProps={{
                  'data-testid': `cms-request-field-max-${index}`,
                  inputMode: 'decimal',
                }}
              />
            </>
          ) : null}
        </Stack>

        {spec.supportsOptions ? (
          <>
            <Divider />
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2">{t('requestFields.options')}</Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={disabled}
                data-testid={`cms-request-field-option-add-${index}`}
                onClick={() => onPatch({ options: [...field.options, emptyFieldOption()] })}
              >
                {t('requestFields.addOption')}
              </Button>
            </Stack>

            {fieldErrors.options ? (
              <Typography variant="caption" color="error">
                {fieldErrors.options}
              </Typography>
            ) : null}

            {field.options.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t('requestFields.noOptions')}
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {field.options.map((option, optionIndex) => {
                  const optionErrors = errors[`option:${option.key}`] ?? {};
                  const testBase = `cms-request-field-option-${index}-${optionIndex}`;
                  return (
                    <Stack
                      key={option.key}
                      direction="row"
                      spacing={1.5}
                      alignItems="flex-start"
                      data-testid={testBase}
                      sx={{ p: 1.5, borderRadius: 2, bgcolor: 'brand.surfaceMuted' }}
                    >
                      <TextField
                        size="small"
                        label={t('requestFields.optionValue')}
                        value={option.value}
                        onChange={(event) =>
                          patchOption(option.key, { value: event.target.value })
                        }
                        error={Boolean(optionErrors.value)}
                        helperText={optionErrors.value}
                        sx={{ width: 180, mt: 4 }}
                        inputProps={{ 'data-testid': `${testBase}-value`, maxLength: 40 }}
                      />
                      <Box sx={{ flexGrow: 1, minWidth: 220 }}>
                        <TranslatedField
                          label={t('requestFields.optionLabel')}
                          value={option.label}
                          onChange={(label) => patchOption(option.key, { label })}
                          languages={languages}
                          languageLabels={languageLabels}
                          defaultLanguage={defaultLanguage}
                          required
                          error={optionErrors.label}
                          testId={`${testBase}-label`}
                        />
                      </Box>
                      <IconButton
                        size="small"
                        onClick={() =>
                          onPatch({
                            options: field.options.filter((entry) => entry.key !== option.key),
                          })
                        }
                        disabled={disabled}
                        aria-label={t('common.delete')}
                        data-testid={`${testBase}-remove`}
                        sx={{ mt: 4 }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </>
        ) : null}
      </Stack>
    </Paper>
  );
}
