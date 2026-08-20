import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { KitImage } from '@/kit/KitImage';
import { SURFACES, type SurfaceKey } from './surfaces';

/**
 * ПРЕВЬЮ — ЭТО ТО, ЧТО УВИДИТ ГОСТЬ, а не миниатюра файла.
 *
 * Раньше редакторы показывали квадратную миниатюру 120×120 — форму, в которой
 * картинка не появляется у гостя нигде. Человек одобрял один кадр, а на витрине
 * получал другой.
 *
 * Рисуем НАСТОЯЩИМ примитивом витрины (`KitImage`) в измеренном соотношении
 * поверхности. Именно примитивом, а не похожей вёрсткой: похожая расходится с
 * настоящей на первой же правке дизайна, и превью начинает врать — тихо и
 * незаметно, потому что выглядит правдоподобно.
 *
 * `KitImage` даёт ещё и заглушку: пока варианты режутся, здесь то же самое, что
 * увидит гость, зайдя в эту секунду.
 */
export interface SurfacePreviewProps {
  src?: string | null;
  surface: SurfaceKey;
  /** Ширина превью в пикселях. По умолчанию — телефонная. */
  width?: number;
  /** Подпись «где это увидит гость». Выключается, когда рядом уже есть своя. */
  caption?: boolean;
  /** Занять родителя целиком вместо собственной рамки (для плитки загрузчика). */
  fill?: boolean;
  testId?: string;
}

export function SurfacePreview({
  src,
  surface,
  width = 300,
  caption = true,
  fill = false,
  testId = 'surface-preview',
}: SurfacePreviewProps) {
  const { t } = useTranslation();
  const spec = SURFACES[surface];
  const isLogo = surface === 'logo';

  return (
    <Box data-testid={testId} sx={fill ? { position: 'absolute', inset: 0 } : undefined}>
      <Box
        sx={{
          ...(fill
            ? { position: 'absolute', inset: 0 }
            : {
                position: 'relative',
                width,
                maxWidth: '100%',
                aspectRatio: String(spec.ratio),
                border: 1,
                borderColor: 'divider',
              }),
          borderRadius: fill ? 0 : 1.5,
          overflow: 'hidden',
          // Логотип не режем рамкой: у него кадр — способ убрать поля, а не
          // вписать в формат, и `cover` съел бы знак по краям.
          ...(isLogo ? { bgcolor: 'brand.surfaceMuted', display: 'grid', placeItems: 'center' } : null),
        }}
      >
        {isLogo ? (
          src ? (
            <Box
              component="img"
              src={src}
              alt=""
              sx={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}
            />
          ) : null
        ) : (
          <KitImage src={src} alt="" fill />
        )}
      </Box>
      {/* Подпись — где именно это появится. Человек не обязан помнить. */}
      {caption ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {t(spec.whereKey)}
        </Typography>
      ) : null}
    </Box>
  );
}
