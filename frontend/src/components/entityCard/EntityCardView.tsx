import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';

import { glassSx } from '@/kit/glass';

/**
 * ВСПЛЫВАЮЩАЯ КАРТОЧКА СУЩНОСТИ — ВИД (партия 59а; утверждён Олегом в v2).
 *
 * ПРИНЦИП: карточка = «главное за 1 секунду». Шапка — фото полосой (заведение)
 * или крупная плитка (заказ, номер); имя крупно, с переносом, без «…»; статус —
 * цветной плашкой; 2–3 факта крупно; одно главное действие и «Открыть».
 * Остальное — на странице сущности.
 *
 * СТЕКЛО `sheet`, а не `menu`: в карточке текст, и подписи обязаны держать 4,5
 * над чем угодно. В светлой теме — кромка и тень плотнее: светлое стекло на
 * белой странице без края не видно (замер v2).
 */

export const CARD_WIDTH = 320;

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function toneColor(theme: Theme, tone: Tone): string {
  if (tone === 'neutral') return theme.palette.text.primary;
  return theme.palette[tone].main;
}

/** Текст тона: в светлой теме — тёмный вариант, чтобы держать 4,5 на стекле. */
export function toneText(theme: Theme, tone: Tone): string {
  if (tone === 'neutral') return theme.palette.text.primary;
  return theme.palette.mode === 'light' ? theme.palette[tone].dark : theme.palette[tone].light;
}

export interface CardFact {
  icon?: ReactNode;
  text: ReactNode;
  tone?: Tone;
}

export interface CardAction {
  label: string;
  tone?: 'primary' | 'danger';
  /** Переход — ссылкой (средняя кнопка открывает вкладку). */
  to?: string;
  onClick?: () => void;
  busy?: boolean;
  testId?: string;
}

export interface EntityCardModel {
  /** Тип — для `aria-label`; на карточке тип говорит фото или плитка. */
  kind: string;
  title: ReactNode;
  /** Строка `aria-label`, когда имя — не строка (номер крупным шрифтом). */
  label?: string;
  subtitle?: ReactNode;
  banner?: ReactNode;
  tile?: ReactNode;
  status?: { label: string; tone: Tone; icon?: ReactNode };
  hero?: { text: ReactNode; caption?: ReactNode; tone?: Tone };
  facts?: CardFact[];
  extra?: ReactNode;
  primary?: CardAction | null;
  open?: CardAction | null;
}

function StatusPill({ label, tone, icon }: NonNullable<EntityCardModel['status']>) {
  return (
    <Box
      data-testid="entity-card-status"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.25,
        py: 0.375,
        borderRadius: 999,
        typography: 'body2',
        fontWeight: 600,
        lineHeight: 1.3,
        color: toneText(theme, tone),
        bgcolor: alpha(toneColor(theme, tone), theme.palette.mode === 'light' ? 0.14 : 0.22),
        whiteSpace: 'nowrap',
        '& svg': { width: 16, height: 16 },
      })}
    >
      {icon}
      {label}
    </Box>
  );
}

function ActionButton({ action, variant }: { action: CardAction; variant: 'contained' | 'text' }) {
  const common = {
    size: 'medium' as const,
    variant,
    color: action.tone === 'danger' ? ('error' as const) : ('primary' as const),
    disabled: action.busy,
    'data-testid': action.testId,
    endIcon: variant === 'text' ? <span aria-hidden>→</span> : undefined,
    sx: { flexShrink: 0 },
  };
  if (action.to) {
    return (
      <Button {...common} component={RouterLink} to={action.to}>
        {action.label}
      </Button>
    );
  }
  return (
    <Button {...common} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

/** Оболочка: стекло, ширина, скругление. И для данных, и для скелета/ошибки. */
function Shell({ sheet, testId, label, children }: { sheet: boolean; testId?: string; label: string; children: ReactNode }) {
  return (
    <Box
      data-testid={testId}
      role="dialog"
      aria-label={label}
      sx={(theme: Theme) => ({
        ...glassSx(theme, 'sheet'),
        ...(theme.palette.mode === 'light'
          ? {
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: `0 18px 40px -16px ${alpha(theme.palette.brand.scrim, 0.45)}`,
            }
          : {}),
        width: sheet ? '100%' : CARD_WIDTH,
        maxWidth: '100%',
        borderRadius: sheet ? '20px 20px 0 0' : 3,
        overflow: 'hidden',
        color: 'text.primary',
        textAlign: 'start',
        fontWeight: 400,
        whiteSpace: 'normal',
      })}
    >
      {children}
    </Box>
  );
}

export function EntityCardView({ model, sheet = false, testId }: { model: EntityCardModel; sheet?: boolean; testId?: string }) {
  const { kind, title, subtitle, banner, tile, status, hero, facts = [], extra, primary, open } = model;
  const label = model.label ?? (typeof title === 'string' ? `${kind}: ${title}` : kind);
  return (
    <Shell sheet={sheet} testId={testId} label={label}>
      {banner ? (
        <Box sx={{ position: 'relative', height: sheet ? 150 : 120, overflow: 'hidden' }}>
          {banner}
          {status ? (
            <Box sx={{ position: 'absolute', top: 10, insetInlineStart: 10, borderRadius: 999, bgcolor: 'background.paper' }}>
              <StatusPill {...status} />
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Box sx={{ p: 2, pt: banner ? 1.5 : 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {tile ? <Box sx={{ flexShrink: 0 }}>{tile}</Box> : null}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              component="div"
              data-testid="entity-card-title"
              sx={{ typography: 'h6', fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}
            >
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
        </Stack>

        {status && !banner ? (
          <Box sx={{ mt: 1.25 }}>
            <StatusPill {...status} />
          </Box>
        ) : null}

        {hero ? (
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 1.25 }} data-testid="entity-card-hero">
            <Typography
              component="div"
              sx={(theme) => ({
                typography: 'h4',
                fontWeight: 700,
                lineHeight: 1,
                color: toneText(theme, hero.tone ?? 'neutral'),
                fontVariantNumeric: 'tabular-nums',
              })}
            >
              {hero.text}
            </Typography>
            {hero.caption ? (
              <Typography variant="body2" color="text.secondary">
                {hero.caption}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {extra ? <Box sx={{ mt: 1.25 }}>{extra}</Box> : null}

        {facts.length ? (
          <Stack spacing={0.75} sx={{ mt: 1.25 }}>
            {facts.map((fact, index) => (
              <Stack
                key={index}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={(theme) => ({
                  typography: 'body1',
                  fontWeight: 500,
                  color: toneText(theme, fact.tone ?? 'neutral'),
                  '& svg': { width: 20, height: 20, flexShrink: 0 },
                })}
              >
                {fact.icon}
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{fact.text}</Box>
              </Stack>
            ))}
          </Stack>
        ) : null}

        {primary || open ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
            {primary ? <ActionButton action={primary} variant="contained" /> : null}
            <Box sx={{ flex: 1 }} />
            {open ? <ActionButton action={open} variant="text" /> : null}
          </Stack>
        ) : null}
      </Box>
    </Shell>
  );
}

/** Пока данные едут: имя уже на экране — карточка не пустая, а с ним. */
export function EntityCardSkeleton({ name, sheet = false }: { name: ReactNode; sheet?: boolean }) {
  return (
    <Shell sheet={sheet} testId="entity-card-loading" label={typeof name === 'string' ? name : ''}>
      <Box sx={{ p: 2 }}>
        <Typography sx={{ typography: 'h6', fontWeight: 700, lineHeight: 1.2 }}>{name}</Typography>
        <Skeleton variant="rounded" height={26} width={120} sx={{ mt: 1.25 }} />
        <Skeleton variant="text" height={36} width={160} sx={{ mt: 1 }} />
        <Skeleton variant="text" width="80%" />
      </Box>
    </Shell>
  );
}

/** 403 / 404 — имя и одна строка, без полей. */
export function EntityCardNotice({ name, text, sheet = false }: { name: ReactNode; text: string; sheet?: boolean }) {
  return (
    <Shell sheet={sheet} testId="entity-card-notice" label={typeof name === 'string' ? name : text}>
      <Box sx={{ p: 2 }}>
        <Typography sx={{ typography: 'h6', fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {text}
        </Typography>
      </Box>
    </Shell>
  );
}
