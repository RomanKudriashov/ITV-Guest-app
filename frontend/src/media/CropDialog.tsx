import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Cropper, { type Area } from 'react-easy-crop';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { SURFACES, safeArea, type SurfaceKey } from './surfaces';
import type { CropRect } from '@/api/types';

/**
 * ВЫБОР КАДРА — ОДИН НА ВСЕ МЕСТА.
 *
 * Раньше кадр не выбирал никто: варианты резались пропорционально, а рамку
 * доделывал `object-fit: cover` — то есть браузер брал центр. Вертикальная
 * фотография в широкой обложке теряла верх и низ молча, и узнавал об этом
 * гость.
 *
 * ЖЕСТ БЕРЁМ ГОТОВЫЙ. `react-easy-crop` умеет перетаскивание, масштаб, пинч,
 * рамку заданного соотношения и затемнение того, что за кадром. Это решённая
 * математика вместе с краевыми случаями, и переписывать её незачем.
 *
 * СВОЁ ЗДЕСЬ — ТРИ ВЕЩИ:
 *   1. соотношение берётся из реестра поверхностей, а не спрашивается у
 *      человека: он не обязан знать, какой формы плитка;
 *   2. подсветка второго кадра — там, где гость на широком экране увидит не то
 *      же, что на телефоне (шапка отеля расходится больше чем вдвое);
 *   3. рамка отдаётся В ДОЛЯХ оригинала, а не в пикселях: оригинал переживёт
 *      перезалив другого размера, а «правая треть сверху» от этого не меняется.
 *
 * РЕЖЕТ СЕРВЕР. Браузер отдаёт только координаты: считать кадр здесь значило бы
 * гнать гостю полный файл и снова отдать рамку `object-fit`.
 */
export interface CropDialogProps {
  open: boolean;
  /** ИСХОДНИК, а не текущий вариант: обрезка всегда идёт от целого кадра. */
  src: string;
  surface: SurfaceKey;
  /** Рамка, выбранная в прошлый раз. Пусто — кадр целиком. */
  value?: CropRect | null;
  onCancel: () => void;
  onApply: (crop: CropRect, ratio: number) => void;
  busy?: boolean;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

export function CropDialog({
  open,
  src,
  surface,
  value,
  onCancel,
  onApply,
  busy = false,
}: CropDialogProps) {
  const { t } = useTranslation();
  const spec = SURFACES[surface];
  const safe = safeArea(spec);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropRect | null>(null);

  /*
    Берём ПЕРВЫЙ аргумент — проценты, а не пиксели.

    Пиксели считаются от размеров исходника, а исходник можно перезалить
    крупнее: тогда «правая треть сверху» уехала бы. Проценты этого не знают и
    потому переживают перезалив; сервер хранит ровно их (доли 0..1).
  */
  const onCropComplete = useCallback((percent: Area) => {
    setArea({
      x: percent.x / 100,
      y: percent.y / 100,
      w: percent.width / 100,
      h: percent.height / 100,
    });
  }, []);

  const apply = () => {
    if (area) onApply(area, spec.ratio);
  };

  /*
    ПЕРЕОТКРЫТЬ ОБРЕЗКУ — УВИДЕТЬ ПРЕЖНЮЮ РАМКУ, а не начать заново.
    Библиотека принимает её только при монтировании, поэтому диалог не
    рендерится, пока закрыт (`open ? … : null` у вызывающего не нужен —
    достаточно ключа, см. ниже).
  */
  const initialArea = value
    ? { x: value.x * 100, y: value.y * 100, width: value.w * 100, height: value.h * 100 }
    : undefined;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="md" fullWidth data-testid="crop-dialog">
      <DialogTitle>{t('media.crop.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          {/* ГДЕ ЭТО УВИДИТ ГОСТЬ — словами, до картинки. */}
          <Typography variant="body2" color="text.secondary" data-testid="crop-where">
            {t(spec.whereKey)}
          </Typography>

          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: { xs: 300, sm: 420 },
              bgcolor: 'common.black',
              borderRadius: 1,
              overflow: 'hidden',
            }}
            data-testid="crop-stage"
          >
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={spec.ratio}
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              initialCroppedAreaPercentages={initialArea}
              restrictPosition
              showGrid
            />

            {/*
              ВТОРОЙ КАДР. Та же картинка на широком экране показывается в
              другом соотношении, и часть выбранной рамки там не видна. Рисуем
              её границы прямо поверх — вместе с подписью ниже, потому что по
              одной рамке человек обязан был бы догадываться, что она значит.
            */}
            {safe ? (
              <Box
                aria-hidden
                data-testid="crop-safe-area"
                sx={{
                  position: 'absolute',
                  left: `${((1 - safe.width) / 2) * 100}%`,
                  top: `${((1 - safe.height) / 2) * 100}%`,
                  width: `${safe.width * 100}%`,
                  height: `${safe.height * 100}%`,
                  border: '2px dashed',
                  borderColor: 'warning.main',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
          </Box>

          {safe ? (
            <Typography variant="caption" color="warning.main" data-testid="crop-safe-hint">
              {t('media.crop.safeHint')}
            </Typography>
          ) : null}

          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('media.crop.zoom')}
            </Typography>
            <Slider
              value={zoom}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              onChange={(_event, next) => setZoom(next as number)}
              data-testid="crop-zoom"
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} data-testid="crop-cancel">
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={apply}
          disabled={!area || busy}
          data-testid="crop-apply"
        >
          {t('media.crop.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
