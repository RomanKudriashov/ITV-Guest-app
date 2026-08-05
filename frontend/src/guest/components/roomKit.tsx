import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import { useStorefront } from '../useStorefront';
import { surfaceRadius } from '../storefrontTokens';

/**
 * Части экрана управления номером по утверждённому макету
 * (docs/design/grms-concept/room-control-mockup.html).
 *
 * Почему здесь, а не в общем ките. Кит белый-лейбл: он берёт цвета из палитры
 * отеля и обязан выглядеть в брендинге любого объекта. Этот экран — намеренное
 * исключение: активное состояние в нём ЗОЛОТОЕ независимо от бренда, потому
 * что иначе на одном экране живут два «активно» (синий вентилятор при золотой
 * дуге уставки). Держать такое исключение в общем ките значило бы протащить
 * его в остальные экраны.
 *
 * Логики состояния тут нет вовсе: компоненты получают готовое чтение и рисуют
 * его. Всё, что касается подтверждения, обмена и оффлайна, решается в
 * `RoomPage` и на сервере.
 */

/* ── Пилюля статуса ───────────────────────────────────────────────────────── */

export type PillTone = 'neutral' | 'cold' | 'warm' | 'ok';

export function StatusPill({
  tone = 'neutral',
  children,
  testId,
}: {
  tone?: PillTone;
  children: ReactNode;
  testId?: string;
}) {
  const { roomControl: t } = useStorefront();
  const color = tone === 'cold' ? t.cold : tone === 'warm' ? t.accent : tone === 'ok' ? t.ok : '';

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      data-testid={testId}
      data-tone={tone}
      sx={(theme) => ({
        // Тот же кегль и та же плотность, что у стеклянного чипа состояния
        // шторы на плите: две одинаковые по смыслу подписи не должны быть
        // разного размера, а вдвое более высокая пилюля съедала экран до плана.
        px: 1.25,
        py: 0.75,
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        border: `1px solid ${color || t.pillBorder}`,
        background: t.pillBackground,
        color: tone === 'neutral' ? 'text.secondary' : color,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      })}
    >
      <Box
        aria-hidden
        sx={{
          width: 6,
          height: 6,
          flex: 'none',
          borderRadius: '50%',
          background: color || t.pillDot,
          boxShadow: color ? `0 0 7px ${color}` : 'none',
        }}
      />
      <Box component="span">{children}</Box>
    </Stack>
  );
}

/* ── Строка управления ────────────────────────────────────────────────────── */

export interface ControlRowProps {
  icon: ReactNode;
  title: string;
  /** Подпись состояния мелким: «2 включено», «выключено», «открыта». */
  subtitle: ReactNode;
  on?: boolean;
  /** Идёт обмен: строка приглушена, но состояние НЕ подменяется. */
  busy?: boolean;
  disabled?: boolean;
  /** Правая часть строки: тумблер, стрелки, что угодно. */
  action?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  /** Задаётся только там, где состояние есть. У сцены его не бывает. */
  pressed?: boolean;
  testId?: string;
}

/**
 * Строка списка — основная единица экрана: иконка, название, подпись
 * состояния, действие справа. Плитки, которыми экран был собран раньше,
 * заменены именно на неё: подпись состояния в плитку не помещалась, и «что
 * сейчас происходит в номере» приходилось угадывать по цвету.
 */
export function ControlRow({
  icon,
  title,
  subtitle,
  on = false,
  busy = false,
  disabled = false,
  action,
  onClick,
  ariaLabel,
  pressed,
  testId,
}: ControlRowProps) {
  const { roomControl: t } = useStorefront();
  const theme = useTheme();
  // Кнопкой строка остаётся и когда заблокирована: `disabled` на настоящей
  // кнопке экранный диктор произносит, а немой `div` — нет.
  const interactive = Boolean(onClick);

  return (
    <Box
      component={interactive ? ButtonBase : 'div'}
      {...(interactive
        ? { type: 'button', onClick, disabled, 'aria-pressed': pressed, 'aria-label': ariaLabel }
        : {})}
      aria-busy={busy || undefined}
      data-testid={testId}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        px: 0.5,
        py: 1.25,
        textAlign: 'start',
        borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
        '& + &': { borderTop: t.rowDivider },
        '&:disabled': { opacity: 0.55 },
        '&.Mui-focusVisible': { outline: `2px solid ${t.cold}`, outlineOffset: 2 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 37,
          height: 37,
          flex: 'none',
          display: 'grid',
          placeItems: 'center',
          borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
          background: on ? t.accentSoft : t.rowIcon,
          color: on ? t.accent : 'text.secondary',
          boxShadow: on ? t.accentGlow : 'none',
          transition: 'background .35s, color .35s, box-shadow .35s',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        {icon}
      </Box>

      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          sx={{ fontFamily: theme.typography.h1.fontFamily, fontWeight: 600 }}
          noWrap
        >
          {title}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: busy ? t.cold : on ? t.accent : 'text.secondary' }}
          noWrap
        >
          {subtitle}
        </Typography>
      </Stack>

      {action}
    </Box>
  );
}

/* ── Тумблер строки ───────────────────────────────────────────────────────── */

export function RowSwitch({ on, dimmed = false }: { on: boolean; dimmed?: boolean }) {
  const { roomControl: t } = useStorefront();
  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        width: 50,
        height: 29,
        flex: 'none',
        borderRadius: 999,
        opacity: dimmed ? 0.45 : 1,
        background: on ? `linear-gradient(180deg,${t.accent},${t.accent})` : t.switchOff,
        transition: 'background .25s, opacity .25s',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 3,
          insetInlineStart: on ? '24px' : '3px',
          width: 23,
          height: 23,
          borderRadius: '50%',
          background: on ? t.switchKnob : t.switchKnobOff,
          transition: 'inset-inline-start .25s cubic-bezier(.3,1.5,.5,1)',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        },
      }}
    />
  );
}

/* ── Сегменты ─────────────────────────────────────────────────────────────── */

export function Segmented({
  value,
  options,
  onChange,
  disabled = false,
  fullWidth = false,
  label,
  testId = 'room-segmented',
}: {
  value: number | null;
  options: { value: number; label: string }[];
  onChange?: (next: number) => void;
  disabled?: boolean;
  /** Занять остаток строки — иначе сегменты сжимаются до нечитаемых. */
  fullWidth?: boolean;
  label?: string;
  testId?: string;
}) {
  const { roomControl: t } = useStorefront();
  return (
    <Stack
      direction="row"
      role="group"
      aria-label={label}
      data-testid={testId}
      sx={(theme) => ({
        flex: fullWidth ? 1 : 'none',
        minWidth: 0,
        border: `1px solid ${t.pillBorder}`,
        borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
        overflow: 'hidden',
        background: t.pillBackground,
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      })}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <ButtonBase
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange?.(option.value)}
            data-testid={`${testId}-${option.value}`}
            sx={(theme) => ({
              flex: 1,
              py: 1.1,
              fontSize: theme.typography.caption.fontSize,
              fontWeight: active ? 700 : 600,
              background: active ? t.accent : 'transparent',
              color: active ? t.accentContrast : 'text.secondary',
              borderInlineStart: `1px solid ${t.pillBorder}`,
              '&:first-of-type': { borderInlineStart: 'none' },
              transition: 'background .2s, color .2s',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              '&.Mui-focusVisible': { outline: `2px solid ${t.cold}`, outlineOffset: -2 },
            })}
          >
            {option.label}
          </ButtonBase>
        );
      })}
    </Stack>
  );
}

/* ── Сдвоенная кнопка шторы ───────────────────────────────────────────────── */

export function CurtainArrows({
  open,
  disabled = false,
  onOpen,
  onClose,
  openLabel,
  closeLabel,
  testId = 'room-curtain-arrows',
}: {
  open: boolean | null;
  disabled?: boolean;
  onOpen: () => void;
  onClose: () => void;
  openLabel: string;
  closeLabel: string;
  testId?: string;
}) {
  const { roomControl: t } = useStorefront();
  const side = (active: boolean) => ({
    flex: 1,
    display: 'grid',
    placeItems: 'center',
    color: active ? t.accent : 'text.secondary',
    '&:disabled': { opacity: 0.45 },
    '&.Mui-focusVisible': { outline: `2px solid ${t.cold}`, outlineOffset: -2 },
  });

  return (
    <Stack
      direction="row"
      data-testid={testId}
      sx={(theme) => ({
        width: 78,
        height: 52,
        flex: 'none',
        border: `1px solid ${t.pillBorder}`,
        borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        background: t.pillBackground,
        overflow: 'hidden',
      })}
    >
      <ButtonBase
        type="button"
        aria-label={closeLabel}
        disabled={disabled}
        onClick={onClose}
        data-testid={`${testId}-close`}
        sx={{ ...side(open === false), borderInlineEnd: `1px solid ${t.pillBorder}` }}
      >
        <ArrowGlyph direction="close" />
      </ButtonBase>
      <ButtonBase
        type="button"
        aria-label={openLabel}
        disabled={disabled}
        onClick={onOpen}
        data-testid={`${testId}-open`}
        sx={side(open === true)}
      >
        <ArrowGlyph direction="open" />
      </ButtonBase>
    </Stack>
  );
}

function ArrowGlyph({ direction }: { direction: 'open' | 'close' }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      sx={{ width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 }}
    >
      {direction === 'open' ? (
        <path d="M8 5 3 12l5 7M16 5l5 7-5 7" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 5l5 7-5 7M20 5l-5 7 5 7" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </Box>
  );
}

/* ── Плитка сцены ─────────────────────────────────────────────────────────── */

export function SceneTile({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
  testId,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const { roomControl: t } = useStorefront();
  return (
    <ButtonBase
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      sx={(theme) => ({
        aspectRatio: '1',
        flexDirection: 'column',
        gap: 0.75,
        borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
        border: `1px solid ${active ? 'transparent' : t.pillBorder}`,
        background: active ? t.accent : t.pillBackground,
        color: active ? t.accentContrast : 'text.secondary',
        boxShadow: active ? t.accentGlow : 'none',
        '&:disabled': { opacity: 0.5 },
        '&.Mui-focusVisible': { outline: `2px solid ${t.cold}`, outlineOffset: 2 },
      })}
    >
      {icon}
      <Typography variant="caption" sx={{ fontWeight: 700, color: 'inherit' }}>
        {label}
      </Typography>
    </ButtonBase>
  );
}

/* ── Кнопка «выключить весь свет» ─────────────────────────────────────────── */

export function OutlineWideButton({
  icon,
  children,
  onClick,
  disabled = false,
  testId,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const { roomControl: t } = useStorefront();
  return (
    <ButtonBase
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      sx={(theme) => ({
        mt: 1.5,
        width: '100%',
        gap: 1,
        py: 1.4,
        borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
        border: `1px solid ${t.pillBorder}`,
        color: 'text.secondary',
        fontSize: theme.typography.body2.fontSize,
        fontWeight: 700,
        '&:disabled': { opacity: 0.45 },
        '&.Mui-focusVisible': { outline: `2px solid ${t.cold}`, outlineOffset: 2 },
      })}
    >
      {icon}
      {children}
    </ButtonBase>
  );
}

/* ── Диск уставки ─────────────────────────────────────────────────────────── */

export interface RoomDialProps {
  target: number;
  current: number | null;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  label: string;
  /** «Уставка» над числом и пояснение под текущей — из словаря переводов. */
  captionSetpoint: string;
  captionCurrent: string;
  captionSensor: string;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (next: number) => void;
  /** «Отправляем уставку» — пока значение под пальцем не стало состоянием. */
  hint?: string | null;
  testId?: string;
}

const DIAL_SWEEP = 270;
const DIAL_START = 135;
const DIAL_RADIUS = 82;
const DIAL_BOX = 200;

/**
 * Диск уставки по макету: кольцо на 270°, дуга теплеет от холодного конца к
 * золоту, ведение пальцем по кольцу, золотой пузырёк над бегунком при
 * перетаскивании и круглые кнопки −/+ ВНУТРИ кольца по нижним углам.
 *
 * Кнопки именно внутри, а не по бокам панели: на телефоне попасть пальцем в
 * дугу трудно, а вынесенные наружу они разрывали композицию панели — в макете
 * они часть диска.
 *
 * Доступность не приносится в жертву виду: это `role="slider"` со стрелками,
 * Home/End и озвученным значением, а кнопки — настоящие button.
 */
export function RoomDial({
  target,
  current,
  min,
  max,
  step,
  disabled = false,
  label,
  captionSetpoint,
  captionCurrent,
  captionSensor,
  decreaseLabel,
  increaseLabel,
  onChange,
  hint = null,
  testId = 'room-dial',
}: RoomDialProps) {
  const theme = useTheme();
  const { roomControl: t } = useStorefront();
  const ringRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const span = Math.max(1, max - min);
  const fraction = Math.max(0, Math.min(1, (target - min) / span));
  const circumference = 2 * Math.PI * DIAL_RADIUS;
  const arc = (DIAL_SWEEP / 360) * circumference;

  const angle = ((DIAL_START + fraction * DIAL_SWEEP) * Math.PI) / 180;
  const knob = {
    left: `${(DIAL_BOX / 2 + DIAL_RADIUS * Math.cos(angle)) / 2}%`,
    top: `${(DIAL_BOX / 2 + DIAL_RADIUS * Math.sin(angle)) / 2}%`,
  };

  const shift = (delta: number) => {
    if (disabled) return;
    const next = Math.max(min, Math.min(max, target + delta));
    if (next !== target) onChange(next);
  };

  const fromPointer = useCallback(
    (x: number, y: number) => {
      const node = ringRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      let degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (degrees < 0) degrees += 360;
      const raw =
        degrees >= DIAL_START
          ? (degrees - DIAL_START) / DIAL_SWEEP
          : (degrees + 360 - DIAL_START) / DIAL_SWEEP;
      const clamped = Math.max(0, Math.min(1, raw));
      const next = min + Math.round((clamped * span) / step) * step;
      if (next !== target) onChange(next);
    },
    [max, min, onChange, span, step, target],
  );

  // Ведение продолжается за пределами кольца: палец на телефоне почти всегда
  // уходит наружу, и обрыв на границе читается как «диск заело».
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => fromPointer(event.clientX, event.clientY);
    const stop = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging, fromPointer]);

  return (
    <Stack alignItems="center" spacing={0.5} data-testid={testId}>
      <Box ref={ringRef} sx={{ position: 'relative', width: 214, maxWidth: '100%', aspectRatio: '1' }}>
        <Box
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuenow={target}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={`${target}°`}
          aria-disabled={disabled || undefined}
          data-testid={`${testId}-surface`}
          onPointerDown={(event) => {
            if (disabled) return;
            setDragging(true);
            fromPointer(event.clientX, event.clientY);
          }}
          onKeyDown={(event) => {
            const map: Record<string, number> = {
              ArrowUp: step,
              ArrowRight: step,
              ArrowDown: -step,
              ArrowLeft: -step,
            };
            if (event.key in map) {
              event.preventDefault();
              shift(map[event.key]);
            } else if (event.key === 'Home') {
              event.preventDefault();
              onChange(min);
            } else if (event.key === 'End') {
              event.preventDefault();
              onChange(max);
            }
          }}
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            borderRadius: '50%',
            cursor: disabled ? 'default' : dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            opacity: disabled ? 0.5 : 1,
            '&:focus-visible': { outline: `2px solid ${t.cold}`, outlineOffset: 4 },
          }}
        />

        <Box
          component="svg"
          viewBox={`0 0 ${DIAL_BOX} ${DIAL_BOX}`}
          aria-hidden
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <circle
            cx={DIAL_BOX / 2}
            cy={DIAL_BOX / 2}
            r={DIAL_RADIUS}
            fill="none"
            stroke={theme.palette.divider}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference * 2}`}
            transform={`rotate(${DIAL_START} ${DIAL_BOX / 2} ${DIAL_BOX / 2})`}
          />
          <circle
            cx={DIAL_BOX / 2}
            cy={DIAL_BOX / 2}
            r={DIAL_RADIUS}
            fill="none"
            // Дуга теплеет от холодного конца шкалы к золоту: сама шкала и
            // есть переход «прохладнее — теплее», и цвет здесь говорит то же,
            // что число.
            stroke={mix(t.cold, t.accent, fraction)}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={`${arc * fraction} ${circumference * 2}`}
            transform={`rotate(${DIAL_START} ${DIAL_BOX / 2} ${DIAL_BOX / 2})`}
            style={{ transition: dragging ? 'none' : 'stroke-dasharray .35s ease, stroke .35s' }}
          />
        </Box>

        <Box
          aria-hidden
          style={knob}
          sx={{
            position: 'absolute',
            zIndex: 3,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: t.switchKnob,
            border: `3px solid ${mix(t.cold, t.accent, fraction)}`,
            transform: 'translate(-50%,-50%)',
            transition: dragging ? 'none' : 'left .35s cubic-bezier(.2,.8,.2,1), top .35s cubic-bezier(.2,.8,.2,1)',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        />

        {dragging ? (
          <Box
            aria-hidden
            data-testid={`${testId}-bubble`}
            style={knob}
            sx={(th) => ({
              position: 'absolute',
              zIndex: 4,
              transform: 'translate(-50%,-175%)',
              px: 1.5,
              py: 0.5,
              borderRadius: 999,
              background: t.accent,
              color: t.accentContrast,
              fontFamily: th.typography.h1.fontFamily,
              fontWeight: 800,
              fontSize: 15,
              whiteSpace: 'nowrap',
            })}
          >
            {target}°
          </Box>
        ) : null}

        <Stack
          aria-hidden
          alignItems="center"
          justifyContent="center"
          sx={{ position: 'absolute', inset: 0, zIndex: 1, textAlign: 'center', px: 4 }}
        >
          <Typography
            variant="caption"
            sx={{ letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: 'text.secondary' }}
          >
            {captionSetpoint}
          </Typography>
          <Typography
            component="b"
            sx={(th) => ({
              fontFamily: th.typography.h1.fontFamily,
              fontSize: 50,
              fontWeight: 800,
              letterSpacing: '-.03em',
              lineHeight: 1,
              my: 0.4,
            })}
          >
            {target}
            <Box component="i" sx={{ fontSize: 22, fontStyle: 'normal', color: 'text.secondary' }}>
              °
            </Box>
          </Typography>
          {current !== null ? (
            <>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                {captionCurrent} {current}°
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                {captionSensor}
              </Typography>
            </>
          ) : null}
        </Stack>

        {/* Кнопки — часть диска, по нижним углам кольца. */}
        <Box sx={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
          <DialButton
            sign="minus"
            label={decreaseLabel}
            disabled={disabled || target <= min}
            onClick={() => shift(-step)}
            testId={`${testId}-minus`}
            corner="start"
          />
          <DialButton
            sign="plus"
            label={increaseLabel}
            disabled={disabled || target >= max}
            onClick={() => shift(step)}
            testId={`${testId}-plus`}
            corner="end"
          />
        </Box>
      </Box>
      <Typography
        variant="caption"
        aria-live="polite"
        data-testid={`${testId}-hint`}
        sx={{ minHeight: 16, color: hint ? t.cold : 'transparent' }}
      >
        {hint ?? '\u00a0'}
      </Typography>
    </Stack>
  );
}

function DialButton({
  sign,
  label,
  disabled,
  onClick,
  testId,
  corner,
}: {
  sign: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
  corner: 'start' | 'end';
}) {
  const { roomControl: t } = useStorefront();
  return (
    <ButtonBase
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      sx={{
        position: 'absolute',
        bottom: 2,
        [corner === 'start' ? 'insetInlineStart' : 'insetInlineEnd']: 2,
        pointerEvents: 'auto',
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: `1px solid ${t.pillBorder}`,
        background: t.rowIcon,
        color: 'text.primary',
        '&:disabled': { opacity: 0.4 },
        '&.Mui-focusVisible': { outline: `2px solid ${t.cold}`, outlineOffset: 2 },
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 24 24"
        aria-hidden
        sx={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }}
      >
        {sign === 'plus' ? <path d="M12 5v14M5 12h14" strokeLinecap="round" /> : <path d="M5 12h14" strokeLinecap="round" />}
      </Box>
    </ButtonBase>
  );
}

/**
 * Смешение двух цветов словаря. Цвет здесь НЕ ЗАДАЁТСЯ — оба конца приезжают
 * из `roomControl`, считается только промежуточная точка шкалы.
 */
function mix(from: string, to: string, ratio: number): string {
  const parse = (value: string) => {
    const hex = value.trim().replace('#', '');
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  };
  try {
    const a = parse(from);
    const b = parse(to);
    const channels = a.map((value, index) => Math.round(value + (b[index] - value) * ratio));
    return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return to;
  }
}

/* ── Вкладки ──────────────────────────────────────────────────────────────── */

export interface RoomTabsProps {
  items: { value: string; label: string }[];
  active: string;
  onChange: (value: string) => void;
  testId?: string;
}

/**
 * Вкладки-строчки с подчёркиванием, как в макете: дисплейный шрифт, активная
 * плотнее и ярче, тонкая золотая линия едет за выбором. Не кнопки-плашки и не
 * заливка — на этом экране заливкой обозначено ВКЛЮЧЕНО, и вкладка в заливке
 * читалась бы как включённый прибор.
 *
 * Линия позиционируется инлайновым стилем: emotion в RTL разворачивает `left`,
 * а линия обязана стоять под своей вкладкой в обеих раскладках.
 */
export function RoomTabs({ items, active, onChange, testId = 'room-tabs' }: RoomTabsProps) {
  const { roomControl: t } = useStorefront();
  const theme = useTheme();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [ink, setInk] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const node = track.querySelector<HTMLElement>(`[data-tab="${CSS.escape(active)}"]`);
      if (node) setInk({ left: node.offsetLeft, width: node.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [active, items]);

  return (
    <Box
      ref={trackRef}
      role="tablist"
      data-testid={testId}
      sx={{
        position: 'relative',
        display: 'flex',
        gap: 3.25,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        '&::after': {
          content: '""',
          position: 'absolute',
          insetInline: 0,
          bottom: 0,
          height: '1px',
          background: t.tabTrack,
        },
      }}
    >
      {items.map((item) => {
        const selected = item.value === active;
        return (
          <ButtonBase
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-tab={item.value}
            data-testid={`${testId}-${item.value}`}
            onClick={() => onChange(item.value)}
            sx={{
              flex: 'none',
              px: 0,
              pt: 1.5,
              pb: 1.4,
              fontFamily: theme.typography.h1.fontFamily,
              fontSize: 14,
              fontWeight: selected ? 500 : 400,
              letterSpacing: '.01em',
              color: selected ? 'text.primary' : 'text.disabled',
              transition: 'color .25s',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              '&.Mui-focusVisible': { outline: `2px solid ${t.cold}`, outlineOffset: 2 },
            }}
          >
            {item.label}
          </ButtonBase>
        );
      })}
      <Box
        aria-hidden
        style={{ left: ink.left, width: ink.width }}
        sx={{
          position: 'absolute',
          bottom: 0,
          height: '1.5px',
          borderRadius: surfaceRadius.panel(theme.palette.brand.radius),
          background: t.accent,
          zIndex: 1,
          transition: 'left .3s cubic-bezier(.3,.8,.2,1), width .3s cubic-bezier(.3,.8,.2,1)',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      />
    </Box>
  );
}

/**
 * Свайп по панели вкладок.
 *
 * Жесты, начатые на органах управления, игнорируются: диск, тумблер, сегменты
 * и стрелки сами обрабатывают протяжку, и без этого исключения ведение уставки
 * пальцем каждый раз перелистывало бы вкладку.
 */
export function useSwipe(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (event: React.TouchEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-swipe-guard]')) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}
