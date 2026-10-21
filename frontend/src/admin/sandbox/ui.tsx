import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { accent, ink, panelSx, pillSx, shape, state, surface, typo } from '../adminTokens';

/**
 * ДЕТАЛИ МАКЕТОВ (партия 62) — из словаря консоли, ни одного своего цвета.
 * Рамка — стекло (`panelSx`), содержимое — плотное.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'gold' | 'muted';

/** Полоса над страницей: это макет, действия не выполняются. */
export function SandboxNotice({ children }: { children: ReactNode }) {
  return (
    <Box
      data-testid="sandbox-notice"
      sx={{
        mb: 2,
        px: 1.75,
        py: 1,
        borderRadius: `${shape.radius}px`,
        border: `1px dashed ${accent.main}`,
        bgcolor: accent.washSoft,
        color: accent.soft,
        ...typo.caption,
        fontWeight: 600,
      }}
    >
      {children}
    </Box>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 2 }}>
      <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
        <Typography component="h1" sx={{ ...typo.pageTitle, color: ink.hi }}>
          {title}
        </Typography>
        {subtitle ? <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.5 }}>{subtitle}</Typography> : null}
      </Box>
      {actions ? <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box> : null}
    </Box>
  );
}

export function Panel({ title, aside, children, sx }: { title?: string; aside?: ReactNode; children: ReactNode; sx?: object }) {
  return (
    <Box sx={{ ...panelSx, ...sx }}>
      {title ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <Typography component="h2" sx={{ ...typo.panelTitle, color: ink.hi, flex: '1 1 auto' }}>
            {title}
          </Typography>
          {aside}
        </Box>
      ) : null}
      {children}
    </Box>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Box component="span" sx={pillSx(tone)}>{children}</Box>;
}

/** Цветная точка состояния — для узких колонок. */
export function Dot({ tone }: { tone: Tone }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        flex: '0 0 auto',
        bgcolor: tone === 'muted' ? ink.low : state[tone],
      }}
    />
  );
}

/** «Образец»: у платформы этих данных нет, макет показывает вид. */
export function Sample() {
  return (
    <Tooltip title="У платформы этих данных пока нет — макет показывает, как это будет выглядеть.">
      <Box
        component="span"
        data-sample=""
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          px: 0.75,
          borderRadius: `${shape.pill}px`,
          border: `1px dashed ${ink.low}`,
          color: ink.mid,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '.04em',
          whiteSpace: 'nowrap',
        }}
      >
        образец
      </Box>
    </Tooltip>
  );
}

/** «В разработке» — заготовка без выключателя. */
export function DevTag() {
  return <Pill tone="muted">в разработке</Pill>;
}

export function FilterChip({
  active,
  label,
  count,
  onClick,
  tone,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
  tone?: Tone;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      data-active={active ? 'true' : undefined}
      sx={{
        height: 32,
        px: 1.5,
        gap: 0.75,
        borderRadius: `${shape.pill}px`,
        ...typo.caption,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        border: `1px solid ${active ? accent.main : surface.line}`,
        bgcolor: active ? accent.washSoft : surface.s2,
        color: active ? accent.soft : ink.mid,
      }}
    >
      {tone ? <Dot tone={tone} /> : null}
      {label}
      {count != null ? <Box component="span" sx={{ color: active ? accent.soft : ink.low }}>{count}</Box> : null}
    </ButtonBase>
  );
}

/** Вкладки-адреса: ряд кнопок, прокручивается на телефоне. */
export function AddressTabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: K; label: string; badge?: number; tone?: Tone }>;
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <Box
      role="tablist"
      sx={{
        display: 'flex',
        gap: 0.5,
        overflowX: 'auto',
        borderBottom: `1px solid ${surface.line}`,
        mb: 2,
        mx: { xs: -2, md: 0 },
        px: { xs: 2, md: 0 },
        scrollbarWidth: 'none',
      }}
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <ButtonBase
            key={tab.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.key)}
            data-testid={`sandbox-tab-${tab.key}`}
            sx={{
              flex: '0 0 auto',
              px: 1.5,
              py: 1.25,
              gap: 0.75,
              ...typo.body,
              fontWeight: on ? 700 : 500,
              color: on ? ink.hi : ink.mid,
              borderBottom: `2px solid ${on ? accent.main : 'transparent'}`,
              mb: '-1px',
            }}
          >
            {tab.label}
            {tab.badge ? (
              <Box component="span" sx={{ ...pillSx(tab.tone ?? 'muted'), px: 0.75, py: 0 }}>
                {tab.badge}
              </Box>
            ) : null}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export function Toggle({ checked, disabled, label }: { checked: boolean; disabled?: boolean; label: string }) {
  return <Switch checked={checked} disabled={disabled} inputProps={{ 'aria-label': label }} size="small" />;
}

/** Пара «подпись — значение» в профиле. */
export function KV({ label, children, note, help }: { label: string; children: ReactNode; note?: ReactNode; help?: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' }, gap: { xs: 0.25, sm: 2 }, py: 1.25, borderBottom: `1px solid ${surface.hair}` }}>
      <Typography sx={{ ...typo.caption, color: ink.mid, pt: { sm: 0.25 } }}>
        {label}
        {help ? <Help>{help}</Help> : null}
      </Typography>
      <Box sx={{ ...typo.body, color: ink.hi, minWidth: 0 }}>
        {children}
        {note ? <Box sx={{ ...typo.caption, color: ink.low, mt: 0.25 }}>{note}</Box> : null}
      </Box>
    </Box>
  );
}

/** Плитка с числом. */
export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <Box sx={{ ...panelSx, minWidth: 0 }}>
      <Typography sx={{ ...typo.label, color: ink.mid }}>{label}</Typography>
      <Typography sx={{ ...typo.metric, color: tone && tone !== 'muted' ? state[tone] : ink.hi, mt: 0.75 }}>{value}</Typography>
      {hint ? <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>{hint}</Typography> : null}
    </Box>
  );
}

export const severityTone = { bad: 'bad', warn: 'warn', info: 'info' } as const;
export const severityLabel = { bad: 'Мешает гостю', warn: 'Требует внимания', info: 'Проверить' } as const;

/** Значок «?» с подробностью: наведение на компьютере, касание на телефоне. */
export function Help({ children }: { children: ReactNode }) {
  return (
    <Tooltip title={<Box sx={{ ...typo.caption, p: 0.5 }}>{children}</Box>} enterTouchDelay={0} leaveTouchDelay={6000} arrow>
      <Box
        component="span"
        tabIndex={0}
        role="button"
        aria-label="Подробнее"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          ml: 0.5,
          borderRadius: '50%',
          border: `1px solid ${surface.line}`,
          color: ink.mid,
          fontSize: 11,
          fontWeight: 700,
          cursor: 'help',
          verticalAlign: 'middle',
          flex: '0 0 auto',
        }}
      >
        ?
      </Box>
    </Tooltip>
  );
}

/** Пустое состояние: что случилось и что делать дальше. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ textAlign: 'center', py: 4, px: 2 }}>
      <Typography sx={{ ...typo.panelTitle, color: ink.hi }}>{title}</Typography>
      {children ? <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.75, maxWidth: 520, mx: 'auto' }}>{children}</Typography> : null}
      {action ? <Box sx={{ mt: 2 }}>{action}</Box> : null}
    </Box>
  );
}

/** Подсветка найденного куска текста. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box component="mark" sx={{ bgcolor: 'var(--adm-state-gold-wash)', color: 'inherit', borderRadius: '3px', px: '1px', outline: `1px solid ${state.gold}` }}>
        {text.slice(at, at + q.length)}
      </Box>
      {text.slice(at + q.length)}
    </>
  );
}

/** Переключатель вида: «Блоки / Список» и т. п. */
export function ViewSwitch<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<[K, string, ReactNode?]>;
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'inline-flex', p: 0.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2, border: `1px solid ${surface.line}`, flex: '0 0 auto' }}>
      {options.map(([key, text, icon]) => (
        <ButtonBase
          key={key}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          sx={{
            gap: 0.75,
            px: 1.25,
            py: 0.6,
            borderRadius: `${shape.radiusSmall}px`,
            ...typo.caption,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            color: value === key ? accent.soft : ink.mid,
            bgcolor: value === key ? accent.wash : 'transparent',
          }}
        >
          {icon}
          {text}
        </ButtonBase>
      ))}
    </Box>
  );
}
