import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMediaQuery, useTheme } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';

import { glassSx } from '@/kit/glass';

/**
 * ВСПЛЫВАЮЩАЯ КАРТОЧКА СУЩНОСТИ — ОБРАЗЕЦ ПАРТИИ 59 (только песочница).
 *
 * Решение Олега: наведение на имя (ПК) или нажатие (телефон) открывает одну и
 * ту же карточку этого типа на любом экране. Здесь — оболочка карточки и
 * механика открытия; рабочие экраны её пока не используют.
 *
 * Механика (образец, см. отчёт разведки):
 *   — ПК: открыть через 350 мс наведения, закрыть через 200 мс после ухода и
 *     с имени, и с карточки (перейти мышью на карточку — она не гаснет);
 *   — клик по имени остаётся переходом по ссылке, карточка ему не мешает;
 *   — клавиатура: фокус на имени открывает сразу, Esc закрывает;
 *   — телефон: наведения нет — первое нажатие открывает карточку снизу
 *     листом, переход — кнопкой «Открыть» в карточке.
 */

export const HOVER_OPEN_MS = 350;
export const HOVER_CLOSE_MS = 200;

export interface EntityField {
  label: string;
  value: ReactNode;
}

export interface EntityAction {
  label: string;
  icon?: ReactNode;
  tone?: 'primary' | 'neutral' | 'danger';
}

export interface EntityCardProps {
  /** Тип сущности — подпись над именем («Заведение», «Позиция»…). */
  kind: string;
  title: string;
  subtitle?: string;
  /** Фото (заведение, позиция) или значок (заказ, номер) — 56×56. */
  media?: ReactNode;
  status?: ReactNode;
  fields: EntityField[];
  actions?: EntityAction[];
  openLabel?: string;
  testId?: string;
  /** Карточка-лист на телефоне — во всю ширину, без стрелки. */
  sheet?: boolean;
}

export function EntityCardBody({
  kind,
  title,
  subtitle,
  media,
  status,
  fields,
  actions = [],
  openLabel = 'Открыть',
  testId,
  sheet = false,
}: EntityCardProps) {
  return (
    <Box
      data-testid={testId}
      role="dialog"
      aria-label={`${kind}: ${title}`}
      sx={(theme: Theme) => ({
        ...glassSx(theme, 'menu'),
        width: sheet ? '100%' : 340,
        borderRadius: sheet ? '20px 20px 0 0' : 3,
        p: 2,
        color: 'text.primary',
      })}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        {media ? (
          <Box sx={{ position: 'relative', width: 56, height: 56, flexShrink: 0, borderRadius: 2, overflow: 'hidden' }}>
            {media}
          </Box>
        ) : null}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.4, display: 'block' }}>
            {kind}
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.25 }} noWrap title={title}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" color="text.secondary" noWrap title={subtitle}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {status ? <Box sx={{ flexShrink: 0, pt: 0.25 }}>{status}</Box> : null}
      </Stack>

      <Box
        component="dl"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(96px, auto) 1fr',
          columnGap: 1.5,
          rowGap: 0.75,
          my: 1.75,
          '& dt': { color: 'text.secondary', typography: 'body2' },
          '& dd': { m: 0, typography: 'body2', minWidth: 0, overflowWrap: 'anywhere' },
        }}
      >
        {fields.map((field) => (
          <Box key={field.label} sx={{ display: 'contents' }}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </Box>
        ))}
      </Box>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {actions.map((action) => (
          <Button
            key={action.label}
            size="small"
            variant={action.tone === 'primary' ? 'contained' : 'outlined'}
            color={action.tone === 'danger' ? 'error' : action.tone === 'primary' ? 'primary' : 'inherit'}
            startIcon={action.icon}
          >
            {action.label}
          </Button>
        ))}
        <Box sx={{ flex: 1 }} />
        <Button size="small" endIcon={<span aria-hidden>→</span>}>
          {openLabel}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * Имя сущности с карточкой — механика образца. `href` остаётся ссылкой:
 * клик по имени на ПК — переход, как сейчас; карточка — только наведение.
 */
export function EntityName({
  children,
  card,
  testId,
}: {
  children: ReactNode;
  card: EntityCardProps;
  testId?: string;
}) {
  const theme = useTheme();
  const touch = useMediaQuery('(hover: none)');
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const schedule = useCallback((next: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sheet = touch || phone;

  return (
    <>
      <Box
        component="a"
        href="#"
        ref={setAnchor}
        data-testid={testId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseEnter={() => !sheet && schedule(true, HOVER_OPEN_MS)}
        onMouseLeave={() => !sheet && schedule(false, HOVER_CLOSE_MS)}
        onFocus={() => !sheet && schedule(true, 0)}
        onBlur={() => !sheet && schedule(false, HOVER_CLOSE_MS)}
        onClick={(event) => {
          // Образец: переходов нет. В рабочем экране на ПК клик — переход,
          // на телефоне первое нажатие — карточка.
          event.preventDefault();
          if (sheet) setOpen((v) => !v);
        }}
        sx={{
          color: 'primary.main',
          textDecoration: 'none',
          borderBottom: '1px dashed',
          borderColor: (t) => t.palette.divider,
          cursor: 'pointer',
          '&:hover, &:focus-visible': { borderBottomStyle: 'solid' },
        }}
      >
        {children}
      </Box>
      {sheet ? (
        open ? (
          <Box
            onClick={() => setOpen(false)}
            sx={{ position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.modal, bgcolor: (t) => alpha(t.palette.brand.scrim, 0.32), display: 'flex', alignItems: 'flex-end' }}
          >
            <Box sx={{ width: '100%' }} onClick={(event) => event.stopPropagation()}>
              <EntityCardBody {...card} sheet />
            </Box>
          </Box>
        ) : null
      ) : (
        <Popper
          open={open && Boolean(anchor)}
          anchorEl={anchor}
          placement="bottom-start"
          modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}
          sx={{ zIndex: (t) => t.zIndex.tooltip }}
        >
          <Box onMouseEnter={() => schedule(true, 0)} onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}>
            <EntityCardBody {...card} />
          </Box>
        </Popper>
      )}
    </>
  );
}
