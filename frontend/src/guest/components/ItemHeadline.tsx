import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppIconComponent } from '@/icons';
import { KitImage } from '@/kit';
import { AllergensBlock, CharacteristicsBlock, NutritionBlock } from './ItemMeta';
import { useStorefront } from '../useStorefront';
import { ItemBadges, PrepMinutesChip } from './ItemBadges';
import { fallbackIconFor } from './typeFallbackIcon';
import { useItemSheetLayout } from './itemSheetLayout';
import { useMoney } from '../hooks/useMoney';
import type { ItemDetail } from '../api/types';
import {
  cardSubtitleColor,
  itemCard,
  panelScrim,
  storefrontTokens,
  surfaceRadius,
} from '../storefrontTokens';
import { openingLabel } from '../nextOpening';

/**
 * Item media — a capped-height cover photo (or the DESIGNED fallback) whose
 * bottom edge dissolves into the page background via a gradient scrim, so the
 * card reads as one canvas rather than "banner then text". `variant` adapts it:
 * `top` sits above the content (phone / stacked), `rail` fills a side column and
 * dissolves along its inline-end edge (desktop side-by-side).
 */
export function ItemMedia({
  item,
  variant = 'top',
  fallbackIcon,
  bleed = false,
  categoryLabel,
}: {
  item: ItemDetail;
  variant?: 'top' | 'rail';
  fallbackIcon?: AppIconComponent;
  /**
   * Название категории — чипом в углу кадра. Приходит сверху, а не читается
   * из позиции: подпись рисуется РОВНО ОДИН РАЗ, а кадр карточка показывает то
   * над содержимым, то в боковой колонке.
   */
  categoryLabel?: string | null;
  /**
   * Вынести кадр за горизонтальные поля контейнера.
   *
   * Нужно в шторке позиции: её содержимое лежит в прокрутке с `px: 2`, и кадр
   * наследовал эти 16px с каждой стороны — «во всю ширину» он не был. Флаг, а
   * не всегда: этот же блок рисует живое превью бренда в CMS, а там карточка
   * скруглённая, и кадр, вылезший за её поля, срезал бы углы.
   */
  bleed?: boolean;
}) {
  const Icon = fallbackIcon ?? fallbackIconFor(item.type);
  const icon = Icon;
  const isRail = variant === 'rail';
  const { glass } = useStorefront();
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        overflow: 'hidden',
        // Кадр упирается в верхние углы карточки — скругляем по её же радиусу,
        // иначе прямой угол снимка торчит из скруглённой шторки.
        ...(bleed
          ? {
              borderTopLeftRadius: `${theme.palette.brand.radius.lg}px`,
              borderTopRightRadius: `${theme.palette.brand.radius.lg}px`,
            }
          : {}),
        ...(isRail
          ? { width: '100%', height: '100%', alignSelf: 'stretch', minHeight: '100%' }
          : {
              // Кадр держит ВЕРХ карточки, а не ленточку под заголовком:
              // 200px на телефоне читались полоской. Потолок остаётся —
              // высокая картинка не должна выталкивать тело за экран.
              height: itemCard.mediaHeight,
              flexShrink: 0,
              /*
                Вынос за поля СДВИГОМ, а не отрицательным полем.

                Родитель — `Stack`, а он в MUI сбрасывает `margin: 0` у всех
                прямых детей селектором с большей специфичностью, чем класс
                самого элемента. Поэтому и `mx: -2`, и явный
                `marginInlineStart` молча обнулялись: ширина применялась, а
                сдвиг нет — кадр становился шире карточки, но упирался не в
                левый край, а в границу отступа, оставляя слева белую полоску и
                вылезая справа.

                `position: relative` у этого блока уже есть, а `inset*` Stack не
                трогает.
              */
              ...(bleed
                ? { width: 'calc(100% + 32px)', insetInlineStart: '-16px' }
                : { width: '100%' }),
            }),
      })}
    >
      <KitImage src={item.images?.[0]} alt={item.title} fill fallbackIcon={icon} fallbackIconSize={isRail ? 64 : 48} />
      {/*
        РАСТВОРЕНИЯ КРАЯ БОЛЬШЕ НЕТ.

        Кромка задумывалась как стык кадра с текстом, но съедала полосу самой
        фотографии: в боковой колонке — правую часть блюда, сверху — нижнюю. У
        карточки и так есть край: скруглённый угол шторки и поля содержимого.
        Кадр теперь заполняет свою панель целиком, как в референсе.
      */}
      {categoryLabel ? (
        // Метка категории — НА КАДРЕ, как в референсе. Подписью над названием
        // она стояла отдельной строкой и терялась между ценой и описанием.
        <Box
          data-testid="guest-item-category"
          sx={(theme) => ({
            position: 'absolute',
            top: itemCard.categoryChipInset,
            insetInlineStart: itemCard.categoryChipInset,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            maxWidth: `calc(100% - ${itemCard.categoryChipInset * 2}px)`,
            px: 1,
            py: 0.5,
            borderRadius: `${theme.palette.brand.radius.pill}px`,
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            lineHeight: 1.2,
            // Стекло — наш собственный приём для подписей поверх снимка: он же
            // держит кнопку закрытия, и метка не заводит второй язык.
            ...glass.chip,
          })}
        >
          <Box aria-hidden sx={{ display: 'flex', flex: 'none' }}>
            <Icon size={itemCard.categoryChipIcon} />
          </Box>
          <Box
            component="span"
            sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {categoryLabel}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

export interface ItemHeadlineViewProps {
  item: ItemDetail;
  /** Already-formatted price, or `null` to hide it (unpriced service). */
  priceLabel: string | null;
  /** Skip the media block — the sheet placed the photo in a side rail. */
  hideMedia?: boolean;
  /** Вынести кадр за поля контейнера — см. `ItemMedia`. */
  bleedMedia?: boolean;
  /** Icon for the designed fallback when the item has no photo. */
  fallbackIcon?: AppIconComponent;
}

/**
 * The part of an item card that is identical for every offering type: picture,
 * title, price, description, flags, allergens, КБЖУ/состав and the "not available
 * now" note. Every block renders FROM DATA — nutrition appears only when the item
 * carries a `nutrition` object, never because of the offering type. Pure and
 * presentational (takes a formatted price, reads no session/query) so the
 * storefront sheet and the CMS brand preview render the same card body.
 */
export const ItemHeadlineView = forwardRef<HTMLHeadingElement, ItemHeadlineViewProps>(
  function ItemHeadlineView(
    { item, priceLabel, hideMedia = false, fallbackIcon, bleedMedia = false },
    titleRef,
  ) {
    const { t } = useTranslation();

    return (
      // Ритм карточки — из словаря: между кадром и содержимым столько же, сколько
      // между содержимым и группами модификаторов ниже.
      <Stack spacing={itemCard.section}>
        {hideMedia ? null : (
          <ItemMedia
            item={item}
            variant="top"
            fallbackIcon={fallbackIcon}
            bleed={bleedMedia}
            categoryLabel={item.category_title}
          />
        )}

        <Stack spacing={itemCard.block}>
          {item.badges?.length ? <ItemBadges badges={item.badges} /> : null}
          <Stack spacing={itemCard.tight}>
            {/* Категория живёт МЕТКОЙ НА КАДРЕ (см. `ItemMedia`). Здесь её
                больше нет: подписью над названием она стояла отдельной строкой
                и терялась между ценой и описанием. */}
            <Typography
              variant="h4"
              component="h2"
              ref={titleRef}
              tabIndex={-1}
              /*
                Карточка при открытии переводит фокус на название — иначе
                читалка объявила бы страницу позади шторки. Но фокус этот
                ПРОГРАММНЫЙ: гость его не просил, а браузер рисовал вокруг
                заголовка рамку, и карточка открывалась с синим прямоугольником
                поперёк названия.
                Рамку убираем, объявление остаётся: заголовок не в цепочке
                табуляции (`tabIndex={-1}`), клавиатурой на него не попасть, и
                отнимать у гостя признак фокуса здесь не у кого.
              */
              sx={{ outline: 'none', fontSize: itemCard.titleSize }}
            >
              {item.title}
            </Typography>
            {/* No price is a legitimate state for a service — never print "0 ₽". */}
            {priceLabel ? (
              <Typography
                variant="h6"
                sx={(theme) => ({ color: theme.palette.brand.primaryStrong, fontFamily: theme.typography.h1.fontFamily })}
              >
                {priceLabel}
              </Typography>
            ) : null}
          </Stack>
          {item.description ? (
            /*
              ТОТ ЖЕ ПРИЁМ, ЧТО НА КАРТОЧКЕ СПИСКА, и теми же вызовами, а не
              повторённый по памяти: подпись в списке и подпись в открытой
              позиции — один и тот же текст, и разъехаться — цветом ли,
              подложкой ли — они могут только если собирать их порознь.
            */
            <Box
              sx={(theme) => {
                /*
                  СТЕКЛО, А НЕ ГЛУХАЯ ПОВЕРХНОСТЬ. Под панелью просвечивает
                  размытое фото блюда — как и задумано. Непрозрачная основа,
                  стоявшая здесь раньше, была вынужденной: стекло над фото
                  давало 3.93:1 при пороге 4.5, и читаемость купили ценой вида.
                  Теперь платить не нужно.
                  
                  ЧИТАЕМОСТЬ ДЕРЖИТ АДАПТИВНАЯ ВУАЛЬ. Её плотность подбирается
                  под фактическую яркость кадра, пока контраст подписи не
                  дотянет до AA с запасом: над тёмным стейком она почти
                  прозрачна, над светлым лимонадом плотнее. Фиксированная
                  прозрачность закрыла бы один случай и сломала другой.
                */
                const glass = storefrontTokens(theme.palette.mode).glass.panel;
                const color = cardSubtitleColor(
                  theme.palette.primary.main,
                  theme.palette.background.paper,
                  theme.palette.mode,
                );
                const scrim = panelScrim(
                  item.image_luminance,
                  theme.palette.mode,
                  theme.palette.background.paper,
                  color,
                );
                return {
                  ...glass,
                  // Вуаль лежит НАД стеклом и ПОД текстом: оба слоя
                  // полупрозрачны, поэтому фотография остаётся видна.
                  backgroundColor: glass.background,
                  backgroundImage: `linear-gradient(${scrim}, ${scrim})`,
                  borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
                  px: 1.25,
                  py: 1,
                };
              }}
            >
              <Typography
                variant="body2"
                sx={(theme) => ({
                  color: cardSubtitleColor(
                    theme.palette.primary.main,
                    theme.palette.background.paper,
                    theme.palette.mode,
                  ),
                })}
              >
                {item.description}
              </Typography>
            </Box>
          ) : null}
          {/* Desktop §3: КБЖУ+portion line, then characteristics, then allergens
              (amber «contains») and markers (green «suitable»). Prep-time chip
              stays. Flags no longer render here — markers/characteristics/badges
              replace them; the catalog list card keeps its flag chips. */}
          <NutritionBlock nutrition={item.nutrition} description={item.description} />
          {/* Линия между БЛОКАМИ, как в референсе: пищевая ценность отделена от
              характеристик, характеристики от групп ниже (их линию рисует сама
              группа). Внутри блоков линий нет. */}
          {item.nutrition && item.characteristics?.length ? <Divider /> : null}
          <CharacteristicsBlock characteristics={item.characteristics} />
          <Stack direction="row" spacing={itemCard.tight} useFlexGap flexWrap="wrap" alignItems="center">
            <PrepMinutesChip minutes={item.prep_minutes} />
          </Stack>
          <AllergensBlock allergens={item.allergens} markers={item.markers} />
        </Stack>

        {!item.is_available ? (
          <Alert severity="warning">
            {openingLabel(item, t) ?? t('guest.menu.unavailable')}
          </Alert>
        ) : null}
      </Stack>
    );
  },
);

/** Session-aware wrapper used by the storefront: formats the price, then delegates. */
export const ItemHeadline = forwardRef<HTMLHeadingElement, { item: ItemDetail }>(
  function ItemHeadline({ item }, titleRef) {
    const { formatOptional } = useMoney();
    const { mediaBeside, fallbackIcon } = useItemSheetLayout();
    return (
      <ItemHeadlineView
        ref={titleRef}
        item={item}
        priceLabel={formatOptional(item.price)}
        hideMedia={mediaBeside}
        bleedMedia
        fallbackIcon={fallbackIcon}
      />
    );
  },
);
