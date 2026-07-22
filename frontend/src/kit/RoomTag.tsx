import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface RoomTagProps {
  /** Small overline label, e.g. "Комната". */
  label?: string;
  /** The room number/name, e.g. "305" — rendered in the display face. */
  room: string;
  /** Visual scale. */
  size?: 'sm' | 'md' | 'lg';
  testId?: string;
}

const SCALE = {
  sm: { padY: 1, padX: 2, num: 'h5', gap: 0 },
  md: { padY: 1.5, padX: 3, num: 'h3', gap: 0.25 },
  lg: { padY: 2, padX: 4, num: 'h1', gap: 0.5 },
} as const;

/**
 * The redesign-v2 signature: an enamel hotel key fob. One bright object — the
 * accent-filled tag with an accent glow and a punched key-ring hole — carrying
 * the room in the display face. Everything else in the UI stays restrained so
 * this reads as the single hero element.
 */
export function RoomTag({ label, room, size = 'md', testId = 'room-tag' }: RoomTagProps) {
  const s = SCALE[size];
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: s.gap,
        minHeight: 44,
        py: s.padY,
        px: s.padX,
        pt: `calc(${theme.spacing(s.padY)} + 10px)`,
        borderRadius: `${theme.palette.brand.radius.lg}px`,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        boxShadow: theme.palette.brand.elevation.glow,
        textAlign: 'center',
        // Punched key-ring hole, filled with the page background so it reads as
        // a hole rather than a dot. Positioned with logical inset for RTL safety.
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 8,
          insetInlineStart: '50%',
          transform: 'translateX(-50%)',
          width: 12,
          height: 12,
          borderRadius: '50%',
          bgcolor: 'background.default',
          boxShadow: `inset 0 0 0 1.5px ${theme.palette.brand.scrim}`,
        },
      })}
    >
      {label ? (
        <Typography
          variant="overline"
          sx={{ lineHeight: 1, opacity: 0.85, letterSpacing: '0.14em' }}
        >
          {label}
        </Typography>
      ) : null}
      <Typography
        variant={s.num}
        component="span"
        sx={(theme) => ({
          lineHeight: 1,
          fontFamily: theme.typography.h1.fontFamily,
          fontWeight: theme.typography.fontWeightBold,
        })}
      >
        {room}
      </Typography>
    </Box>
  );
}
