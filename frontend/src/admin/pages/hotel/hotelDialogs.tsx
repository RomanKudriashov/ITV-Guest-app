import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { fieldSx, ink, primaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import { AdminDialog, DateChoiceField } from '../../form';
import type { NeedsConfirmation } from '../../adminClient';

/**
 * ОКНА КАРТОЧКИ ОТЕЛЯ (партия 62-C, по утверждённому макету).
 *
 * Отключение — с причиной (её видит только Control) и необязательной датой
 * авто-включения; одно окно на карточку и на массовое действие «Отелей».
 * Подтверждение опасной правки — последствия от сервера (409), словами
 * экрана по коду строки.
 */

function tomorrow(): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  return day.toISOString().slice(0, 10);
}

export function DisableDialog({
  title,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  busy: boolean;
  onSubmit: (body: { reason: string; enable_on: string | null }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [enableOn, setEnableOn] = useState('');
  const rows = ['guest', 'staff', 'room', 'control'] as const;
  return (
    <AdminDialog
      testId="admin-disable-dialog"
      title={title}
      subtitle={t('admin.card.disable.subtitle')}
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotel.cancel')}</Button>
          <Button
            sx={{ ...primaryButtonSx, bgcolor: state.bad, '&:hover': { bgcolor: state.bad } }}
            disabled={!reason.trim() || busy}
            onClick={() => onSubmit({ reason: reason.trim(), enable_on: enableOn || null })}
            data-testid="admin-disable-submit"
          >
            {t('admin.card.disable.submit')}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <TextField
          label={t('admin.card.disable.reason')}
          required
          multiline
          minRows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('admin.card.disable.reasonPlaceholder')}
          helperText={t('admin.card.disable.reasonHint')}
          sx={fieldSx}
          inputProps={{ 'data-testid': 'admin-disable-reason' }}
        />
        {/* Поле формы занимает колонки сетки формы — в своей коробке, иначе
            окно становится 12-колоночным и остальное сжимается в столбик. */}
        <Box sx={{ display: 'grid' }}>
          <DateChoiceField
            label={t('admin.card.disable.enableOn')}
            value={enableOn}
            onChange={setEnableOn}
            min={tomorrow()}
            helperText={t('admin.card.disable.enableOnHint')}
            testId="admin-disable-enable-on"
          />
        </Box>
        <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2 }}>
          <Typography sx={{ ...typo.label, color: ink.mid, mb: 1 }}>{t('admin.card.disable.whatHappens')}</Typography>
          {rows.map((row) => (
            <Box key={row} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '110px 1fr' }, gap: { xs: 0, sm: 1 }, py: 0.5, ...typo.caption }}>
              <Box sx={{ fontWeight: 700, color: ink.hi }}>{t(`admin.card.disable.who.${row}`)}</Box>
              <Box sx={{ color: ink.mid }}>{t(`admin.card.disable.what.${row}`)}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </AdminDialog>
  );
}

export function ConfirmChangesDialog({
  need,
  busy,
  onConfirm,
  onClose,
}: {
  need: NeedsConfirmation;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AdminDialog
      testId="admin-profile-confirm"
      title={t('admin.profile.confirm.title')}
      subtitle={t('admin.profile.confirm.subtitle')}
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotel.cancel')}</Button>
          <Button sx={primaryButtonSx} disabled={busy} onClick={onConfirm} data-testid="admin-profile-confirm-submit">
            {t('admin.profile.confirm.submit')}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {need.fields.map((field) => (
          <Box key={field} data-testid={`admin-profile-confirm-${field}`} sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2 }}>
            <Typography sx={{ ...typo.body, fontWeight: 700, color: ink.hi, mb: 0.75 }}>
              {t(`admin.profile.field.${field}`)}
            </Typography>
            {(need.consequences[field] ?? []).map((line) => (
              <Box key={line.code} sx={{ display: 'flex', gap: 1, ...typo.caption, color: ink.mid, py: 0.25 }}>
                <Box sx={{ color: state.warn }}>•</Box>
                {t(`admin.profile.consequence.${field}.${line.code}`, { defaultValue: line.text })}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </AdminDialog>
  );
}
