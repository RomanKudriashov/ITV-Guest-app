import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { accent, fieldSx, ink, shadow, shape, surface, typo } from './adminTokens';
import { spanSx, type FormSpan } from '@/kit/formLayout';

export { FormCell, FormGrid } from '@/kit/formLayout';

/**
 * ФОРМЫ КОНСОЛИ — ОДИН НАБОР ПРИМИТИВОВ.
 *
 * Ширину поля назначали по месту, и в одном столбце «Нового отеля» стояло
 * пять разных ширин: 552, 552, 552, 120, 416, 326, 210. Каждая была по-своему
 * разумной («валюта короткая», «пресет влезает в 210»), и именно поэтому они
 * не сходились: решение принималось семь раз.
 *
 * Здесь оно принимается один раз. Форма — сетка в двенадцать колонок, поле
 * объявляет, сколько колонок занимает, и всегда заполняет свою ячейку целиком.
 * «Валюта» по-прежнему уже «Языков» — но потому, что занимает 3 колонки из 12,
 * а не потому, что кто-то написал 120px.
 */

/** Диалог консоли: одна рамка, один заголовок, один ряд действий. */
export function AdminDialog({
  title,
  subtitle,
  onClose,
  actions,
  children,
  testId,
  maxWidth = 'sm',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions: ReactNode;
  children: ReactNode;
  testId: string;
  maxWidth?: 'xs' | 'sm' | 'md';
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      data-testid={testId}
      slotProps={{
        paper: {
          sx: {
            bgcolor: surface.s1,
            backgroundImage: 'none',
            border: `1px solid ${surface.line}`,
            borderRadius: `${shape.radiusLarge}px`,
            boxShadow: shadow.dialog,
          },
        },
      }}
    >
      <DialogTitle sx={{ p: '20px 24px 0' }}>
        <Typography component="span" sx={{ ...typo.pageTitle, fontSize: 20, color: ink.hi }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>{subtitle}</Typography>
        ) : null}
      </DialogTitle>
      <DialogContent sx={{ p: '20px 24px 4px' }}>{children}</DialogContent>
      <DialogActions sx={{ p: '12px 24px 20px', gap: 1 }}>{actions}</DialogActions>
    </Dialog>
  );
}

/** Заголовок над группой внутри формы. */
export function FormLabel({ children }: { children: ReactNode }) {
  return <Typography sx={{ ...typo.label, color: ink.mid, mb: 1 }}>{children}</Typography>;
}

/** Поле формы. Ширину задаёт `span`, вид — общий `fieldSx`. */
export function Field({
  span = 12,
  ...props
}: TextFieldProps & { span?: FormSpan }) {
  return <TextField {...props} sx={[fieldSx, spanSx(span)]} />;
}

/**
 * Пилюля выбора — та же геометрия, что у пилюли статуса, но нажимаемая.
 *
 * Именно у неё пропадала рамка: `border: 1px solid var(--adm-surface-line)`
 * внутри диалога упирался в неопределённую переменную (диалог живёт в портале
 * вне поддерева консоли), и браузер выбрасывал объявление целиком. Переменные
 * теперь на `:root`, а рамка описана здесь один раз.
 */
export function ChoicePill({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? 'true' : undefined}
      sx={{
        ...typo.caption,
        fontWeight: 600,
        px: 1.5,
        py: 0.85,
        borderRadius: `${shape.pill}px`,
        cursor: 'pointer',
        color: active ? accent.onAccent : ink.mid,
        bgcolor: active ? accent.main : 'transparent',
        border: `1px solid ${active ? accent.main : surface.line}`,
        transition: 'background-color .16s, border-color .16s, color .16s',
        '&:hover': { borderColor: active ? accent.main : ink.low },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      {children}
    </Box>
  );
}
