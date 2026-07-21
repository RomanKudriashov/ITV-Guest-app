import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
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
import {
  emptyGroup,
  emptyOption,
  normalizeGroup,
  type DraftGroup,
  type DraftOption,
} from './modifierDrafts';

export interface ModifierGroupsEditorProps {
  groups: DraftGroup[];
  onChange: (groups: DraftGroup[]) => void;
  languages: string[];
  languageLabels: Record<string, string>;
  defaultLanguage: string;
  currencySymbol: string;
  /** `target -> field -> message`, produced by local + server validation. */
  errors: Record<string, Record<string, string>>;
  disabled?: boolean;
}

export function ModifierGroupsEditor({
  groups,
  onChange,
  languages,
  languageLabels,
  defaultLanguage,
  currencySymbol,
  errors,
  disabled = false,
}: ModifierGroupsEditorProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const patchGroup = (key: string, changes: Partial<DraftGroup>) =>
    onChange(
      groups.map((group) =>
        group.key === key ? normalizeGroup({ ...group, ...changes }) : group,
      ),
    );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = groups.findIndex((group) => group.key === active.id);
    const to = groups.findIndex((group) => group.key === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(groups, from, to));
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack>
          <Typography variant="subtitle1">{t('modifiers.title')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('modifiers.hint')}
          </Typography>
        </Stack>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={disabled}
          data-testid="modifier-group-add"
          onClick={() => onChange([...groups, emptyGroup()])}
        >
          {t('modifiers.addGroup')}
        </Button>
      </Stack>

      {groups.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="modifier-groups-empty">
          {t('modifiers.empty')}
        </Typography>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={groups.map((group) => group.key)}
            strategy={verticalListSortingStrategy}
          >
            <Stack spacing={2} data-testid="modifier-group-list">
              {groups.map((group, index) => (
                <GroupCard
                  key={group.key}
                  group={group}
                  index={index}
                  languages={languages}
                  languageLabels={languageLabels}
                  defaultLanguage={defaultLanguage}
                  currencySymbol={currencySymbol}
                  errors={errors}
                  disabled={disabled}
                  onPatch={(changes) => patchGroup(group.key, changes)}
                  onRemove={() => onChange(groups.filter((entry) => entry.key !== group.key))}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Stack>
  );
}

interface GroupCardProps {
  group: DraftGroup;
  index: number;
  languages: string[];
  languageLabels: Record<string, string>;
  defaultLanguage: string;
  currencySymbol: string;
  errors: Record<string, Record<string, string>>;
  disabled: boolean;
  onPatch: (changes: Partial<DraftGroup>) => void;
  onRemove: () => void;
}

function GroupCard({
  group,
  index,
  languages,
  languageLabels,
  defaultLanguage,
  currencySymbol,
  errors,
  disabled,
  onPatch,
  onRemove,
}: GroupCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.key,
  });
  const groupErrors = errors[`group:${group.key}`] ?? {};

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const patchOption = (key: string, changes: Partial<DraftOption>) =>
    onPatch({
      options: group.options.map((option) =>
        option.key === key ? { ...option, ...changes } : option,
      ),
    });

  const handleOptionsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = group.options.findIndex((option) => option.key === active.id);
    const to = group.options.findIndex((option) => option.key === over.id);
    if (from < 0 || to < 0) return;
    onPatch({ options: arrayMove(group.options, from, to) });
  };

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`modifier-group-${index}`}
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
          <Chip size="small" label={t('modifiers.groupN', { n: index + 1 })} />
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            size="small"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t('common.delete')}
            data-testid={`modifier-group-remove-${index}`}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>

        <TranslatedField
          label={t('modifiers.groupTitle')}
          value={group.title}
          onChange={(title) => onPatch({ title })}
          languages={languages}
          languageLabels={languageLabels}
          defaultLanguage={defaultLanguage}
          required
          error={groupErrors.title}
          testId={`modifier-group-title-${index}`}
        />

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="flex-start">
          <TextField
            select
            size="small"
            label={t('modifiers.selection')}
            value={group.selection}
            onChange={(event) =>
              onPatch({ selection: event.target.value as DraftGroup['selection'] })
            }
            sx={{ minWidth: 160 }}
            inputProps={{ 'data-testid': `modifier-group-selection-${index}` }}
          >
            <MenuItem value="single">{t('modifiers.single')}</MenuItem>
            <MenuItem value="multi">{t('modifiers.multi')}</MenuItem>
          </TextField>

          <FormControlLabel
            control={
              <Switch
                checked={group.is_required}
                onChange={(event) => onPatch({ is_required: event.target.checked })}
                inputProps={
                  { 'data-testid': `modifier-group-required-${index}` } as Record<string, string>
                }
              />
            }
            label={t('modifiers.required')}
          />

          <TextField
            size="small"
            type="number"
            label={t('modifiers.min')}
            value={group.min_choices}
            onChange={(event) => onPatch({ min_choices: Number(event.target.value) })}
            error={Boolean(groupErrors.min_choices)}
            helperText={groupErrors.min_choices}
            sx={{ width: 120 }}
            inputProps={{ min: 0, 'data-testid': `modifier-group-min-${index}` }}
          />
          <Tooltip
            title={group.selection === 'single' ? t('modifiers.singleLocked') : ''}
            placement="top"
          >
            <TextField
              size="small"
              type="number"
              label={t('modifiers.max')}
              value={group.max_choices}
              onChange={(event) => onPatch({ max_choices: Number(event.target.value) })}
              disabled={group.selection === 'single'}
              error={Boolean(groupErrors.max_choices)}
              helperText={groupErrors.max_choices}
              sx={{ width: 120 }}
              inputProps={{ min: 1, 'data-testid': `modifier-group-max-${index}` }}
            />
          </Tooltip>
        </Stack>

        <Divider />

        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2">{t('modifiers.options')}</Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            disabled={disabled}
            data-testid={`modifier-option-add-${index}`}
            onClick={() => onPatch({ options: [...group.options, emptyOption()] })}
          >
            {t('modifiers.addOption')}
          </Button>
        </Stack>

        {groupErrors.options ? (
          <Typography variant="caption" color="error">
            {groupErrors.options}
          </Typography>
        ) : null}

        {group.options.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t('modifiers.noOptions')}
          </Typography>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleOptionsDragEnd}
          >
            <SortableContext
              items={group.options.map((option) => option.key)}
              strategy={verticalListSortingStrategy}
            >
              <Stack spacing={1.5}>
                {group.options.map((option, optionIndex) => (
                  <OptionRow
                    key={option.key}
                    option={option}
                    groupIndex={index}
                    optionIndex={optionIndex}
                    languages={languages}
                    languageLabels={languageLabels}
                    defaultLanguage={defaultLanguage}
                    currencySymbol={currencySymbol}
                    errors={errors[`option:${option.key}`] ?? {}}
                    disabled={disabled}
                    onPatch={(changes) => patchOption(option.key, changes)}
                    onRemove={() =>
                      onPatch({
                        options: group.options.filter((entry) => entry.key !== option.key),
                      })
                    }
                  />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        )}
      </Stack>
    </Paper>
  );
}

interface OptionRowProps {
  option: DraftOption;
  groupIndex: number;
  optionIndex: number;
  languages: string[];
  languageLabels: Record<string, string>;
  defaultLanguage: string;
  currencySymbol: string;
  errors: Record<string, string>;
  disabled: boolean;
  onPatch: (changes: Partial<DraftOption>) => void;
  onRemove: () => void;
}

function OptionRow({
  option,
  groupIndex,
  optionIndex,
  languages,
  languageLabels,
  defaultLanguage,
  currencySymbol,
  errors,
  disabled,
  onPatch,
  onRemove,
}: OptionRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.key,
  });
  const testBase = `modifier-option-${groupIndex}-${optionIndex}`;

  return (
    <Stack
      ref={setNodeRef}
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={testBase}
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'brand.surfaceMuted',
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{ display: 'flex', color: 'text.secondary', cursor: 'grab', pt: 1 }}
        aria-label={t('common.reorder')}
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>

      <Box sx={{ flexGrow: 1, minWidth: 220 }}>
        <TranslatedField
          label={t('modifiers.optionTitle')}
          value={option.title}
          onChange={(title) => onPatch({ title })}
          languages={languages}
          languageLabels={languageLabels}
          defaultLanguage={defaultLanguage}
          required
          error={errors.title}
          testId={`${testBase}-title`}
        />
      </Box>

      <TextField
        size="small"
        label={t('modifiers.priceDelta')}
        value={option.priceInput}
        onChange={(event) => onPatch({ priceInput: event.target.value })}
        error={Boolean(errors.price_delta)}
        helperText={errors.price_delta}
        sx={{ width: 150, mt: 4 }}
        InputProps={{
          endAdornment: <InputAdornment position="end">{currencySymbol}</InputAdornment>,
        }}
        inputProps={{ 'data-testid': `${testBase}-price` }}
      />

      <Stack sx={{ mt: 3 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={option.is_default}
              onChange={(event) => onPatch({ is_default: event.target.checked })}
              inputProps={{ 'data-testid': `${testBase}-default` } as Record<string, string>}
            />
          }
          label={<Typography variant="caption">{t('modifiers.isDefault')}</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={option.is_active}
              onChange={(event) => onPatch({ is_active: event.target.checked })}
              inputProps={{ 'data-testid': `${testBase}-active` } as Record<string, string>}
            />
          }
          label={<Typography variant="caption">{t('item.active')}</Typography>}
        />
      </Stack>

      <IconButton
        size="small"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t('common.delete')}
        data-testid={`${testBase}-remove`}
        sx={{ mt: 4 }}
      >
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}
