import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { KitImage } from '@/kit';
import type { AppIconComponent } from '@/icons';
import type { ItemCharacteristic, ItemDetail, ItemFacet } from '../api/types';
import { itemCard, surfaceRadius } from '../storefrontTokens';

/** Dietary / kitchen flags. Unknown codes fall back to the raw code. */
export function FlagChips({ flags, size = 'small' }: { flags: string[]; size?: 'small' | 'medium' }) {
  const { t } = useTranslation();
  if (!flags?.length) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {flags.map((flag) => (
        <Chip
          key={flag}
          size={size}
          variant="outlined"
          label={t(`guest.flags.${flag}`, { defaultValue: flag })}
          sx={{ height: 22, fontSize: '0.7rem' }}
        />
      ))}
    </Stack>
  );
}

/**
 * Allergens («contains» — amber pills) and dietary markers («suitable» — green
 * pills), reference desktop §3. Localized titles come from the payload. Renders
 * nothing when the item carries neither — no empty «Аллергены» block.
 */
/** Dietary markers as green chips — the catalog card keeps these (allergens do not). */
export function MarkerChips({ markers, size = 'small' }: { markers?: ItemFacet[]; size?: 'small' | 'medium' }) {
  if (!markers?.length) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {markers.map((marker) => (
        <Chip
          key={marker.code}
          size={size}
          variant="outlined"
          label={marker.title}
          data-testid={`guest-marker-${marker.code}`}
          sx={(theme) => ({
            height: 22,
            fontSize: '0.7rem',
            color: theme.palette.success.main,
            borderColor: `color-mix(in srgb, ${theme.palette.success.main} 42%, transparent)`,
          })}
        />
      ))}
    </Stack>
  );
}

export function AllergensBlock({
  allergens,
  markers,
}: {
  allergens?: ItemFacet[];
  markers?: ItemFacet[];
}) {
  const { t } = useTranslation();
  const hasAllergens = Boolean(allergens?.length);
  const hasMarkers = Boolean(markers?.length);
  if (!hasAllergens && !hasMarkers) return null;

  /*
    ДВА РАЗНЫХ УТВЕРЖДЕНИЯ — ДВЕ РАЗНЫЕ ПОДПИСИ.

    Аллергены отвечают «что здесь есть, если вам нельзя», маркеры — «кому это
    подходит». Раньше обе группы стояли под одной шапкой «Аллергены», и на
    стенде это читалось как «аллергены: халяль, без глютена». Ошибка не
    косметическая: гость с аллергией читает именно эту строку.
  */
  return (
    <Stack spacing={itemCard.block} data-testid="guest-item-allergens">
      {hasAllergens ? (
        <FacetGroup caption={t('guest.item.contains')}>
          {allergens!.map((a) => (
            <FacetPill key={`a-${a.code}`} label={a.title} tone="contains" />
          ))}
        </FacetGroup>
      ) : null}
      {hasMarkers ? (
        <FacetGroup caption={t('guest.item.suitableFor')}>
          {markers!.map((m) => (
            <FacetPill key={`m-${m.code}`} label={m.title} tone="suitable" />
          ))}
        </FacetGroup>
      ) : null}
    </Stack>
  );
}

/** Подпись и ряд пилюль под ней — общая рамка для обеих групп. */
function FacetGroup({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <Box>
      <MetaCaption>{caption}</MetaCaption>
      <Stack direction="row" spacing={itemCard.tight} useFlexGap flexWrap="wrap">
        {children}
      </Stack>
    </Box>
  );
}

/** Подпись над блоком карточки: одна на КБЖУ, характеристики и пилюли. */
function MetaCaption({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        color: 'text.secondary',
        mb: itemCard.tight,
      }}
    >
      {children}
    </Typography>
  );
}

function FacetPill({ label, tone }: { label: string; tone: 'contains' | 'suitable' }) {
  return (
    <Box
      component="span"
      sx={(theme) => {
        const base = tone === 'contains' ? theme.palette.warning.main : theme.palette.success.main;
        return {
          display: 'inline-flex',
          alignItems: 'center',
          px: 1,
          py: 0.35,
          borderRadius: `${theme.palette.brand.radius.sm}px`,
          fontSize: '0.72rem',
          fontWeight: 600,
          lineHeight: 1.4,
          color: base,
          bgcolor: `color-mix(in srgb, ${base} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${base} 38%, transparent)`,
        };
      }}
    >
      {label}
    </Box>
  );
}

/** Ordered «name → value» characteristics (desktop §3). Empty → nothing. */
export function CharacteristicsBlock({ characteristics }: { characteristics?: ItemCharacteristic[] }) {
  if (!characteristics?.length) return null;
  /*
    СЕТКА, А НЕ РЯД ИЗ ДВУХ ЯЧЕЕК. Пока каждая строка верстала себя сама с
    `minWidth: 130`, длинное название («Способ приготовления») эту ширину
    перебивало и уносило своё значение вправо, а короткое («Вкус») оставляло
    значение на месте — колонка значений шла лесенкой. Grid держит обе строки
    в одной сетке по определению.
  */
  return (
    <Box
      data-testid="guest-item-characteristics"
      sx={{
        display: 'grid',
        gridTemplateColumns: `minmax(0, ${itemCard.labelColumn}px) minmax(0, 1fr)`,
        columnGap: 1.5,
        rowGap: 0.5,
        fontSize: '0.82rem',
      }}
    >
      {characteristics.map((row, i) => (
        <Fragment key={i}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {row.name}
          </Box>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
            {row.value}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

/**
 * КБЖУ + состав. Rendered ENTIRELY from the presence of data — a card shows the
 * calories/macros row only when the item carries them, and the состав line only
 * when it is filled in. It never branches on the offering type: a service or a
 * booking with a `nutrition` block would render the very same way.
 */
export function NutritionBlock({
  nutrition,
  description,
}: {
  nutrition?: ItemDetail['nutrition'];
  /** Описание позиции — чтобы не печатать состав, если это тот же текст. */
  description?: string | null;
}) {
  const { t } = useTranslation();
  if (!nutrition) return null;

  // Ячейки, а не таблица: у карточки нет колонок, есть ритм.
  const macros: { label: string; value: number }[] = [];
  if (nutrition.calories != null)
    macros.push({ label: t('guest.item.kcal'), value: nutrition.calories });
  // Единица в подписи, а не подразумевается. Белки, жиры, углеводы и порция
  // измеряются в граммах, и в ячейке «32 / Белки» это сказать больше негде:
  // раньше единицу держала соседняя подпись в общей строке.
  const grams = (label: string) => `${label}, ${t('guest.item.gram')}`;
  if (nutrition.protein != null)
    macros.push({ label: grams(t('guest.item.protein')), value: nutrition.protein });
  if (nutrition.fat != null)
    macros.push({ label: grams(t('guest.item.fat')), value: nutrition.fat });
  if (nutrition.carbs != null)
    macros.push({ label: grams(t('guest.item.carbs')), value: nutrition.carbs });
  if (nutrition.portion != null)
    macros.push({ label: grams(t('guest.item.portion')), value: nutrition.portion });

  // Состав и описание часто оказываются одним текстом (в сиде так и было —
  // состав копировался из описания). Гостю незачем читать одну строку дважды:
  // если они совпадают, состав не показываем — описание уже сказало это выше.
  const rawComposition = nutrition.composition?.trim();
  const composition =
    rawComposition && rawComposition !== (description ?? '').trim() ? rawComposition : undefined;
  if (!macros.length && !composition) return null;

  /*
    ЯЧЕЙКА НА КАЖДОЕ ЗНАЧЕНИЕ: число сверху, подпись под ним.

    Раньше это была одна строка вида «506 ккал 32 Белки 27 Жиры 12 Углеводы
    порция 185 г»: числа и подписи чередовались без единой паузы и слипались
    в поток, где «32 Белки» читается как одно слово. Порция вдобавок шла в
    обратном порядке — сначала подпись, потом число. Теперь у всех ячеек один
    порядок и одна сетка, а «порция» — такая же ячейка, как остальные.
  */
  return (
    <Stack spacing={itemCard.block} data-testid="guest-item-nutrition">
      {macros.length ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${itemCard.macroMinWidth}px, max-content))`,
            columnGap: 2.5,
            rowGap: 1,
          }}
        >
          {macros.map((macro) => (
            <Box key={macro.label}>
              <Box
                sx={(theme) => ({
                  color: 'text.primary',
                  fontFamily: theme.typography.h1.fontFamily,
                  fontWeight: theme.typography.fontWeightBold,
                  fontSize: '1.0625rem',
                  lineHeight: 1.2,
                  fontVariantNumeric: 'tabular-nums',
                })}
              >
                {macro.value}
              </Box>
              <Box sx={{ color: 'text.secondary', fontSize: '0.72rem', lineHeight: 1.4 }}>
                {macro.label}
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
      {composition ? (
        <Box>
          <MetaCaption>{t('guest.item.composition')}</MetaCaption>
          <Typography variant="body2" color="text.secondary">
            {composition}
          </Typography>
        </Box>
      ) : null}
    </Stack>
  );
}

/**
 * Compact one-line КБЖУ for a catalog card (reference `.nutri`): the calorie
 * value reads in the display face, the macros follow as a muted, dot-separated
 * run. Rendered only from the data the item actually carries. Units stay numeric
 * (ккал / г) so the single line is correct in every language, not just RU.
 */
export function NutritionInline({ nutrition }: { nutrition?: ItemDetail['nutrition'] }) {
  const { t } = useTranslation();
  if (!nutrition) return null;
  const { calories, protein, fat, carbs, portion } = nutrition;
  const macros = [protein, fat, carbs].filter((v): v is number => v != null);
  if (calories == null && !macros.length) return null;

  return (
    <Typography
      component="div"
      variant="caption"
      color="text.secondary"
      data-testid="guest-item-nutrition-inline"
      sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}
    >
      {calories != null ? (
        <Box component="span">
          <Box
            component="b"
            sx={(theme) => ({
              color: 'text.secondary',
              fontFamily: theme.typography.h1.fontFamily,
              fontWeight: theme.typography.fontWeightBold,
              fontVariantNumeric: 'tabular-nums',
              mr: 0.375,
            })}
          >
            {calories}
          </Box>
          {t('guest.item.kcal')}
        </Box>
      ) : null}
      {calories != null && macros.length ? <Box component="span">·</Box> : null}
      {macros.length ? (
        <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {macros.join(' · ')} {t('guest.item.gram')}
        </Box>
      ) : null}
      {portion != null ? (
        <>
          <Box component="span">·</Box>
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {t('guest.item.portion')} {portion} {t('guest.item.gram')}
          </Box>
        </>
      ) : null}
    </Typography>
  );
}

/**
 * Square thumbnail — a lazy image with a skeleton, or a DESIGNED fallback (a
 * monochrome icon on a textured token surface) when the item has no photo. Never
 * a flat coloured circle.
 */
export function ItemThumb({
  src,
  alt,
  size = 72,
  dimmed = false,
  fallbackIcon,
}: {
  src?: string | null;
  alt: string;
  size?: number;
  dimmed?: boolean;
  fallbackIcon?: AppIconComponent;
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: (theme) => surfaceRadius.panel(theme.palette.brand.radius),
        overflow: 'hidden',
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <KitImage src={src} alt={alt} fill fallbackIcon={fallbackIcon} fallbackIconSize={Math.round(size * 0.4)} />
    </Box>
  );
}
