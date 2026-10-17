import Box from '@mui/material/Box';

import { KitImage } from '@/kit/KitImage';
import type { ImageRef } from '@/kit/imageRef';
import { fallbackIconFor } from './typeFallbackIcon';

/**
 * ЗНАЧОК ЗАВЕДЕНИЯ (партия 38, п.68): квадрат из обложки → иконка по типу →
 * цвет бренда.
 *
 * Есть обложка — квадрат вырезается из неё (`object-fit: cover` в квадратной
 * рамке родителя). Нет обложки — иконка ПО ТИПУ заведения на основном цвете
 * бренда. Раньше без фото везде рисовалась вилка-нож — в том числе у СПА и
 * хозслужбы. Рамку (размер, скругление, `position: relative`) задаёт место
 * показа: значок заполняет её целиком.
 */
export function VenueMark({
  image,
  imageRef,
  sizes = '56px',
  serviceType,
  iconSize = 28,
}: {
  image: string | null | undefined;
  /** Объект обложки (партия 58а) — файл по размеру значка. */
  imageRef?: ImageRef | null;
  /** Размер места значка для `sizes` (по умолчанию — строка поиска, 56 px). */
  sizes?: string;
  serviceType: string | null | undefined;
  iconSize?: number;
}) {
  const Icon = fallbackIconFor(null, serviceType);
  if (imageRef || image) {
    return <KitImage image={imageRef} src={image} sizes={sizes} alt="" fill fallbackIcon={Icon} fallbackIconSize={iconSize} />;
  }
  return (
    <Box
      aria-hidden
      data-mark="icon"
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
      }}
    >
      <Icon size={iconSize} />
    </Box>
  );
}
