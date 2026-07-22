/**
 * Lightweight inline charts.
 *
 * The repo ships NO charting library (see package.json), and the task forbids
 * adding one — so dynamics and breakdowns are drawn as plain SVG/CSS here.
 * Colours come exclusively from the theme palette (project rule: no literal
 * colours outside `theme/tokens.ts`), and the SVG scales with its container so
 * it stays RTL- and responsive-safe.
 */
import { useId } from 'react';
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export interface LinePoint {
  label: string;
  value: number;
}

const VIEW_W = 640;
const VIEW_H = 180;
const PAD_X = 8;
const PAD_Y = 12;

/** A single-series line + area chart drawn in a normalised viewBox. */
export function LineChart({
  points,
  formatValue,
  testId,
  ariaLabel,
}: {
  points: LinePoint[];
  formatValue?: (value: number) => string;
  testId?: string;
  ariaLabel?: string;
}) {
  const theme = useTheme();
  const gradientId = useId();

  if (points.length === 0) {
    return null;
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = VIEW_W - PAD_X * 2;
  const innerH = VIEW_H - PAD_Y * 2;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = PAD_X + (points.length > 1 ? i * step : innerW / 2);
    const y = PAD_Y + innerH - (p.value / max) * innerH;
    return { x, y, point: p };
  });

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(PAD_Y + innerH).toFixed(
    1,
  )} L${coords[0].x.toFixed(1)},${(PAD_Y + innerH).toFixed(1)} Z`;

  return (
    <Box sx={{ width: '100%' }} data-testid={testId}>
      <Box
        component="svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        sx={{ width: '100%', height: 180, display: 'block' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.28} />
            <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke={theme.palette.primary.main}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={2.5}
            fill={theme.palette.primary.main}
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {c.point.label}: {formatValue ? formatValue(c.point.value) : c.point.value}
            </title>
          </circle>
        ))}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {points[0].label}
        </Typography>
        {points.length > 1 ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {points[points.length - 1].label}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

/**
 * A horizontal bar row — used both as a standalone breakdown chart and as an
 * in-cell mini-bar behind a table value. `fraction` is 0..1 of the row max.
 */
export function Bar({ fraction }: { fraction: number }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <Box
      sx={{
        position: 'relative',
        height: 6,
        borderRadius: 3,
        bgcolor: 'brand.surfaceMuted',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          width: `${clamped * 100}%`,
          bgcolor: 'primary.main',
          borderRadius: 3,
        }}
      />
    </Box>
  );
}
