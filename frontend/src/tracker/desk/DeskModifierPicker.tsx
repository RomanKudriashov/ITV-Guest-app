import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import type { ItemDetail, ModifierGroup } from '@/guest/api/types';

/**
 * Модификаторы позиции для заказа за гостя. Правила групп — те же, что у
 * гостя (обязательность, минимум и максимум); проверяет их и сервер.
 */
export function DeskModifierPicker({
  itemId,
  title,
  loader,
  onClose,
  onPick,
}: {
  itemId: string;
  title: string;
  loader: (id: string) => Promise<ItemDetail>;
  onClose: () => void;
  onPick: (optionIds: string[], optionTitles: string[]) => void;
}) {
  const { t } = useTranslation();
  const detail = useQuery({
    queryKey: ['tracker', 'desk', 'item', itemId],
    queryFn: () => loader(itemId),
  });
  const [chosen, setChosen] = useState<Record<string, string[]>>({});

  const groups = detail.data?.modifier_groups ?? [];
  const selected = (group: ModifierGroup) =>
    chosen[group.id] ?? group.options.filter((o) => o.is_default).map((o) => o.id);
  const valid = groups.every((group) => {
    const count = selected(group).length;
    const min = group.is_required ? Math.max(1, group.min_choices) : group.min_choices;
    return count >= min && (!group.max_choices || count <= group.max_choices);
  });

  const toggle = (group: ModifierGroup, optionId: string) => {
    const current = selected(group);
    const next =
      group.selection === 'single'
        ? [optionId]
        : current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
    setChosen({ ...chosen, [group.id]: next });
  };

  const pick = () => {
    const ids = groups.flatMap((group) => selected(group));
    const titles = groups.flatMap((group) =>
      group.options.filter((o) => selected(group).includes(o.id)).map((o) => o.title),
    );
    onPick(ids, titles);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" data-testid="desk-modifiers">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {detail.isLoading ? (
          <Skeleton variant="rounded" height={120} />
        ) : detail.error ? (
          <Alert severity="error">{t('tracker.desk.order.failed')}</Alert>
        ) : (
          <Stack spacing={2}>
            {groups.map((group) => (
              <Stack key={group.id} spacing={0.25}>
                <Typography variant="subtitle2">
                  {group.title}
                  {group.is_required ? ' *' : ''}
                </Typography>
                {group.options.map((option) => (
                  <FormControlLabel
                    key={option.id}
                    control={
                      group.selection === 'single' ? (
                        <Radio checked={selected(group).includes(option.id)} />
                      ) : (
                        <Checkbox checked={selected(group).includes(option.id)} />
                      )
                    }
                    onChange={() => toggle(group, option.id)}
                    label={option.title}
                    data-testid={`desk-modifier-${option.code}`}
                  />
                ))}
              </Stack>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('tracker.desk.order.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!valid || detail.isLoading}
          onClick={pick}
          data-testid="desk-modifiers-add"
        >
          {t('tracker.desk.order.add')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
