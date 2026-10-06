import Box from '@mui/material/Box';

import { KitImage } from '@/kit/KitImage';
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
  serviceType,
  iconSize = 28,
}: {
  image: string | null | undefined;
  serviceType: string | null | undefined;
  iconSize?: number;
}) {
  const Icon = fallbackIconFor(null, serviceType);
  if (image) {
    return <KitImage src={image} alt="" fill fallbackIcon={Icon} fallbackIconSize={iconSize} />;
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
