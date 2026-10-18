import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { KitImage } from '@/kit/KitImage';
import type { ImageRef } from '@/kit/imageRef';
import { ROLE_PLACES, checkPlace, placeSize, type MediaRole, type Place } from './places';

/**
 * ВСЕ МЕСТА, ГДЕ ЭТО ФОТО УВИДИТ ГОСТЬ (партия 58в) — на 1440 и 390.
 *
 * Рисует НАСТОЯЩИЙ примитив витрины (`KitImage`, тот же `fill`/`whole`), а не
 * похожую вёрстку: похожая расходится с гостевой на первой правке и начинает
 * врать правдоподобно. Место уменьшено, но форма у него настоящая — значит, и
 * доля кадра, и решение «целиком» те же, что у гостя.
 *
 * Красная метка — место, которое покажет плохо: «целиком» видит меньше 60 %
 * (фото встанет на размытую копию), или оригинала не хватает при DPR 2 — с
 * подсказкой, какой ширины оригинал нужен.
 */
const WIDE_MAX = 220;
const PHONE_MAX = 120;

export function PlacesGrid({ image, role }: { image: ImageRef; role: MediaRole }) {
  const { t } = useTranslation();
  const places = ROLE_PLACES[role];
  if (!places.length) return null;
  return (
    <Box
      data-testid="places-grid"
      sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } }}
    >
      {places.map((place) => (
        <Box key={place.key}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>
            {t(place.labelKey)}
          </Typography>
          <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
            <PlacePreview image={image} place={place} screen="wide" max={WIDE_MAX} />
            <PlacePreview image={image} place={place} screen="phone" max={PHONE_MAX} />
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

function PlacePreview({
  image,
  place,
  screen,
  max,
}: {
  image: ImageRef;
  place: Place;
  screen: 'wide' | 'phone';
  max: number;
}) {
  const { t } = useTranslation();
  const ratio = image.w && image.h ? image.w / image.h : 4 / 3;
  const size = placeSize(place, screen, ratio);
  if (!size) return <Box sx={{ width: max }} />;
  const [pw, ph] = size;
  const scale = Math.min(1, max / pw);
  const check = image.w && image.h ? checkPlace(place.fit, size, image.w, image.h) : null;
  const testId = `place-${place.key}-${screen}`;
  return (
    <Box sx={{ width: Math.round(pw * scale) }} data-testid={testId} data-bad={check?.bad ? 'true' : 'false'}>
      <Box
        sx={{
          position: 'relative',
          width: Math.round(pw * scale),
          aspectRatio: `${pw} / ${ph}`,
          borderRadius: 1,
          overflow: 'hidden',
          border: 2,
          borderColor: check?.bad ? 'error.main' : 'divider',
        }}
      >
        <KitImage image={image} sizes={`${Math.round(pw * scale)}px`} fit={place.fit} alt="" fill />
      </Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {t(screen === 'wide' ? 'media.place.screenWide' : 'media.place.screenPhone')} · {pw}×{ph}
      </Typography>
      {check?.wholeShrunk ? (
        <Typography variant="caption" color="error" display="block" data-testid={`${testId}-whole`}>
          {t('media.place.wholeShrunk', { share: Math.round(check.share * 100) })}
        </Typography>
      ) : null}
      {check && check.stretch > 1 ? (
        <Typography variant="caption" color="error" display="block" data-testid={`${testId}-weak`}>
          {t('media.place.needOriginal', { px: check.needWidth })}
        </Typography>
      ) : null}
    </Box>
  );
}
