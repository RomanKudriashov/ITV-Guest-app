import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import type { FocusPoint } from '@/api/types';
import type { ImageRef } from '@/kit/imageRef';
import { PlacesGrid } from './PlacesGrid';
import { roleNeedWidth, type MediaRole } from './places';

/**
 * ТОЧКА ГЛАВНОГО ВМЕСТО РАМКИ КАДРА (партия 58в).
 *
 * Рамка резала фото под одну форму, а гость видит его в десятке форм — от
 * значка 56×56 до шапки 1080×360. После 58а варианты режутся из целого
 * оригинала, и каждое место кладёт фото по фокусу. Человеку остаётся отметить
 * одно: что в кадре главное. Кликом или стрелками; рядом — все места роли на
 * 1440 и 390 тем же `KitImage`, что у гостя, и они двигаются вместе с точкой.
 *
 * Клавиатура: стрелки — шаг 2 %, с Shift — 10 %, Enter — сохранить.
 */
export interface FocusEditorProps {
  open: boolean;
  /** Исходник — точка ставится по целому кадру. */
  src: string;
  /** Объект картинки: форма кадра и ряд ширин для превью мест. */
  image: ImageRef;
  role: MediaRole;
  onCancel: () => void;
  onSave: (focus: FocusPoint) => void;
  busy?: boolean;
}

const STEP = 0.02;
const STEP_BIG = 0.1;
const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

export function FocusEditor({ open, src, image, role, onCancel, onSave, busy = false }: FocusEditorProps) {
  const { t } = useTranslation();
  const phone = useMediaQuery(useTheme().breakpoints.down('md'));
  const [focus, setFocus] = useState<FocusPoint>(image.focus ?? { x: 0.5, y: 0.5 });
  const live: ImageRef = { ...image, focus };
  const need = image.w && image.h ? roleNeedWidth(role, image.w, image.h) : 0;
  const weak = need > 0 && (image.w ?? 0) < need;

  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setFocus({ x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) });
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP_BIG : STEP;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key === 'Enter') {
      event.preventDefault();
      onSave(focus);
      return;
    }
    const delta = move[event.key];
    if (!delta) return;
    event.preventDefault();
    setFocus((prev) => ({ x: clamp(prev.x + delta[0]), y: clamp(prev.y + delta[1]) }));
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xl" fullWidth fullScreen={phone} data-testid="focus-editor">
      <DialogTitle>{t('media.focus.title')}</DialogTitle>
      <DialogContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
          <Stack spacing={1.25} sx={{ width: { xs: '100%', md: 420 }, flexShrink: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {t('media.focus.hint')}
            </Typography>
            <Box
              role="slider"
              tabIndex={0}
              aria-label={t('media.focus.aria')}
              aria-valuetext={t('media.focus.value', { x: pct(focus.x), y: pct(focus.y) })}
              data-testid="focus-stage"
              data-focus-x={focus.x}
              data-focus-y={focus.y}
              onClick={pick}
              onKeyDown={keys}
              sx={{
                position: 'relative',
                // Высота не больше 45/60 % экрана — сужаем ШИРИНУ, а не режем
                // высоту: форма сцены — форма фото, иначе клик промахнётся.
                width: {
                  xs: `min(100%, calc(45vh * ${image.w || 4} / ${image.h || 3}))`,
                  md: `min(100%, calc(60vh * ${image.w || 4} / ${image.h || 3}))`,
                },
                mx: 'auto',
                aspectRatio: `${image.w || 4} / ${image.h || 3}`,
                cursor: 'crosshair',
                borderRadius: 1,
                overflow: 'hidden',
                bgcolor: 'common.black',
                outlineOffset: 3,
                '&:focus-visible': { outline: (th) => `2px solid ${th.palette.primary.main}` },
              }}
            >
              <Box
                component="img"
                src={src}
                alt=""
                draggable={false}
                sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', userSelect: 'none' }}
              />
              {/* Точка главного: кольцо и перекрестие, видны на любом кадре. */}
              <Box
                aria-hidden
                data-testid="focus-point"
                sx={{
                  position: 'absolute',
                  left: pct(focus.x),
                  top: pct(focus.y),
                  width: 30,
                  height: 30,
                  ml: '-15px',
                  mt: '-15px',
                  borderRadius: '50%',
                  border: '3px solid',
                  borderColor: 'common.white',
                  boxShadow: (th) => `0 0 0 2px ${th.palette.common.black}, 0 2px 10px ${th.palette.common.black}`,
                  pointerEvents: 'none',
                  '&::before, &::after': {
                    content: '""',
                    position: 'absolute',
                    bgcolor: 'common.white',
                    left: '50%',
                    top: '50%',
                  },
                  '&::before': { width: 2, height: 10, ml: '-1px', mt: '-5px' },
                  '&::after': { width: 10, height: 2, ml: '-5px', mt: '-1px' },
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" data-testid="focus-value">
              {t('media.focus.value', { x: pct(focus.x), y: pct(focus.y) })} · {t('media.focus.keys')}
            </Typography>
            {weak ? (
              <Alert severity="warning" data-testid="focus-weak-original">
                {t('media.weakOriginal', { have: image.w, need })}
              </Alert>
            ) : null}
          </Stack>
          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
            <PlacesGrid image={live} role={role} />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} data-testid="focus-cancel">
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={() => onSave(focus)} disabled={busy} data-testid="focus-save">
          {t('media.focus.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
