import { memo, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';

import type { OfferingType } from '@/offerings/behaviour';
import type { MenuItem } from '../api/types';
import { KitImage } from '@/kit/KitImage';
import { focusPosition, srcSetOf } from '@/kit/imageRef';
import { ItemBadges } from '../components/ItemBadges';
import { QuantityStepper } from '../components/QuantityStepper';
import { fallbackIconFor } from '../components/typeFallbackIcon';
import { useCart } from '../state/cart';
import { fontPx, mosaicScrim, mosaicTile, surfaceRadius } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
import { decideAdd } from './addAction';
import { CELL_RATIO, layoutGallery, type TileSize } from './layoutGallery';
import { unavailableNote } from './unavailableNote';

/**
 * ВИД «МОЗАИКА» (партия 57) — фото одной категории плитками без дыр.
 *
 * Раскладка — `layoutGallery`: акцент (большая 2×2 + мелкие) и ряд мелких по
 * очереди, хвост растянут. Высота ряда — от ширины КОНТЕЙНЕРА через container
 * query (`cqw`): размер плитки известен до загрузки фото, и вёрстка не прыгает.
 *
 * Плитка говорит только главное: название, цена, один бейдж, стоп-лист.
 * Описание, маркеры, КБЖУ и время — в карточке позиции, по тапу.
 */
const GAP = { phone: 6, wide: 8 };
/** Высота клетки = 0.75 ширины колонки (≈4:3, как у образца). */
const ROW_RATIO = CELL_RATIO;
/** Ширина контейнера витрины на ПК (Container lg) — для запасной высоты без cqw. */
const SHELL_MAX = 1200;

/*
  ШИРИНА ПЛИТКИ ДЛЯ `sizes` (партия 58а) — по раскладке, а не одной цифрой на
  всё: пролёт колонок × ширина колонки контейнера. ПК (4 колонки) — контейнер lg,
  1032 px на ≥1080; середина (3) — контейнер sm, 552 px; телефон (2) — экран
  без полей 16. Большая плитка 2×2 получает вдвое больше мелкой.
*/
const WIDE_INNER = 1032;
const MID_INNER = 552;

export function mosaicTileSizes(colSpan: number, cols: number, gap: number): string {
  const span = (inner: number) => Math.round(colSpan * ((inner - (cols - 1) * gap) / cols) + (colSpan - 1) * gap);
  if (cols >= 4) {
    return `(min-width: 1080px) ${span(WIDE_INNER)}px, ${Math.round((100 * colSpan) / cols)}vw`;
  }
  if (cols === 3) return `${span(MID_INNER)}px`;
  return `${Math.round((100 * colSpan) / cols)}vw`;
}

export interface MenuMosaicProps {
  items: MenuItem[];
  fallbackType: OfferingType;
  categoryAvailable: boolean;
  onOpen: (item: MenuItem) => void;
  formatPrice: (minor: number | null | undefined) => string | null;
}

export function MenuMosaic({ items, fallbackType, categoryAvailable, onOpen, formatPrice }: MenuMosaicProps) {
  // Колонки: 4 от 1024, 2 на телефоне, между — 3 (см. mosaicColumns).
  const wide = useMediaQuery('(min-width:1024px)');
  const mid = useMediaQuery('(min-width:600px)');
  const cols = wide ? 4 : mid ? 3 : 2;
  const gap = wide ? GAP.wide : GAP.phone;
  const placed = useMemo(() => layoutGallery(items, cols, (item) => Boolean(item.mosaic_large)), [items, cols]);

  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Box
        data-testid="guest-mosaic-grid"
        data-cols={cols}
        sx={{
          display: 'grid',
          gap: `${gap}px`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          // Запас для браузера без container queries — от ширины окна.
          gridAutoRows: `calc((min(100vw, ${SHELL_MAX}px) - 32px - ${(cols - 1) * gap}px) / ${cols} * ${ROW_RATIO})`,
          '@supports (width: 1cqw)': {
            gridAutoRows: `calc((100cqw - ${(cols - 1) * gap}px) / ${cols} * ${ROW_RATIO})`,
          },
        }}
      >
        {placed.map((p) => (
          <MosaicTile
            key={p.item.id}
            item={p.item}
            size={p.size}
            col={p.col}
            row={p.row}
            colSpan={p.colSpan}
            rowSpan={p.rowSpan}
            sizes={mosaicTileSizes(p.colSpan, cols, gap)}
            fallbackType={fallbackType}
            available={p.item.is_available && categoryAvailable}
            onOpen={onOpen}
            priceLabel={formatPrice(p.item.price)}
          />
        ))}
      </Box>
    </Box>
  );
}

interface MosaicTileProps {
  item: MenuItem;
  size: TileSize;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  /** Ширина места плитки для `sizes` (по её пролёту в раскладке). */
  sizes: string;
  fallbackType: OfferingType;
  available: boolean;
  onOpen: (item: MenuItem) => void;
  priceLabel: string | null;
}

const MosaicTile = memo(function MosaicTile({
  item,
  size,
  col,
  row,
  colSpan,
  rowSpan,
  sizes,
  fallbackType,
  available,
  onOpen,
  priceLabel,
}: MosaicTileProps) {
  const { t } = useTranslation();
  const { tile } = useStorefront();
  const [broken, setBroken] = useState(false);
  const big = size === 'l';
  // Объект кадра (партия 58а): ряд ширин и фокус. Нет — прежний адрес строкой.
  const photo = item.photos?.[0] ?? null;
  const src = photo?.src || item.images?.[0] || null;
  const showImage = Boolean(src) && !broken;
  const FallbackIcon = fallbackIconFor(item.type ?? fallbackType, item.service_type);
  const note = unavailableNote(item, available, t);
  // Один бейдж — старший: первый по порядку, как их сортирует сервер.
  const badge = item.badges?.length ? [...item.badges].sort((a, b) => a.sort_order - b.sort_order)[0] : null;
  // Затухание подложки — только в верхних 24/14 px блока, выше букв (поле
  // сверху 40/28): при прежних 40/28 полная плотность начиналась ровно на
  // строке названия, и её верх лежал на затухании — 3,3:1 на светлом кадре
  // (замер 58б).
  const scrim = mosaicScrim(item.image_luminance, big ? 24 : 14);
  const open = () => onOpen(item);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  return (
    <Box
      role="button"
      tabIndex={0}
      data-testid={`guest-mosaic-tile-${item.code}`}
      data-size={size}
      data-col={col}
      data-row={row}
      aria-label={
        note
          ? t('guest.menu.tileAriaOff', { title: item.title, note })
          : priceLabel
            ? t('guest.menu.tileAria', { title: item.title, price: priceLabel })
            : item.title
      }
      onClick={open}
      onKeyDown={onKeyDown}
      sx={(theme) => ({
        gridColumn: `${col} / span ${colSpan}`,
        gridRow: `${row} / span ${rowSpan}`,
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        borderRadius: surfaceRadius.inner(theme.palette.brand.radius),
        // Фирменная подложка видна, пока фото нет или оно грузится. Тёмная в
        // обеих темах: текст на плитке белый.
        backgroundColor: tile.fallbackColor,
        backgroundImage: tile.fallbackGradient,
        // Изоляция перерисовки: плитка вне экрана не пересчитывается.
        contain: 'layout paint',
        '&:focus-visible': { outline: `3px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        '@media (hover: hover) and (prefers-reduced-motion: no-preference)': {
          '&:hover .mosaic-media': { transform: 'scale(1.045)' },
        },
      })}
    >
      <Box
        className="mosaic-media"
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          transition: 'transform .35s cubic-bezier(.2,.7,.2,1)',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        {showImage && photo?.widths.length ? (
          /*
            Объект картинки — общий примитив витрины (партия 58а): файл по
            ширине плитки (`sizes` от раскладки), кадр по фокусу и ПРЕДЕЛ
            ОБРЕЗКИ. Растянутый на весь ряд «хвост» (1032×189 при вертикальном
            фото) показывал 12% кадра; меньше 60% — фото целиком поверх
            размытого себя.
          */
          <KitImage image={photo} sizes={sizes} fit="fill" alt="" fill fallbackIcon={FallbackIcon} fallbackIconSize={big ? 72 : 44} />
        ) : showImage ? (
          /* Строкой пришедшая картинка (старый ответ) — как было. */
          <Box
            component="img"
            src={src ?? undefined}
            srcSet={photo?.widths.length ? srcSetOf(photo) : undefined}
            sizes={photo?.widths.length ? sizes : undefined}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            sx={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: photo ? focusPosition(photo) : 'center',
              display: 'block',
            }}
          />
        ) : (
          <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'common.white' }}>
            <Box sx={{ opacity: 0.55, transform: 'translateY(-14%)', display: 'flex' }}>
              <FallbackIcon size={big ? 72 : 44} />
            </Box>
          </Box>
        )}
      </Box>

      {/*
        Общего градиента «глубины» больше нет (партия 58б): он лежал вторым
        слоем под подложкой и затемнял кадр там, где текста нет. Одно
        затемнение — подложка текстового блока ниже.
      */}

      {badge ? (
        <Box sx={{ position: 'absolute', top: 8, insetInlineStart: 8, maxWidth: 'calc(100% - 16px)' }}>
          <ItemBadges badges={[badge]} size="sm" />
        </Box>
      ) : null}

      {note ? (
        <Box
          data-testid={`guest-mosaic-off-${item.code}`}
          sx={{ position: 'absolute', inset: 0, bgcolor: mosaicTile.offDim, display: 'grid', placeItems: 'center' }}
        >
          <Box
            component="span"
            sx={(theme) => ({
              px: 1.25,
              py: 0.5,
              mx: 1,
              textAlign: 'center',
              borderRadius: surfaceRadius.pill(theme.palette.brand.radius),
              color: 'common.white',
              bgcolor: mosaicTile.offPlate,
              border: `1px solid ${mosaicTile.offPlateBorder}`,
              fontSize: fontPx(12),
              fontWeight: 700,
            })}
          >
            {note}
          </Box>
        </Box>
      ) : null}

      {/* Подложка текстового блока: под буквами не светлее plateMin. */}
      <Box
        sx={{
          position: 'absolute',
          insetInline: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1,
          p: big ? { xs: 1.5, md: 2 } : { xs: 1, md: 1.25 },
          pt: big ? 5 : 3.5,
          background: scrim.plate,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, color: 'common.white', textShadow: mosaicTile.textShadow }}>
          <Typography
            component="span"
            sx={(theme) => ({
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontFamily: theme.typography.h1.fontFamily,
              fontWeight: 700,
              lineHeight: 1.18,
              color: 'common.white',
              fontSize: big ? { xs: fontPx(17), md: fontPx(21) } : { xs: fontPx(13.5), md: fontPx(15) },
            })}
          >
            {item.title}
          </Typography>
          {priceLabel ? (
            <Typography
              component="span"
              data-testid={`guest-mosaic-price-${item.code}`}
              sx={{
                display: 'block',
                mt: 0.35,
                fontWeight: 800,
                color: 'common.white',
                fontSize: big ? { xs: fontPx(16), md: fontPx(18) } : { xs: fontPx(13.5), md: fontPx(14.5) },
              }}
            >
              {priceLabel}
            </Typography>
          ) : null}
        </Box>
        {note ? null : <TileAction item={item} fallbackType={fallbackType} available={available} onOpen={open} />}
      </Box>
    </Box>
  );
});

/**
 * «+» / счётчик −N+. Решение «сразу или карточка» — общее с карточками
 * (`decideAdd`): у позиции с любым выбором «+» открывает карточку, и на нём
 * бейдж количества (строк может быть несколько с разными опциями, поэтому «−»
 * здесь неоднозначен — правится в корзине).
 */
function TileAction({
  item,
  fallbackType,
  available,
  onOpen,
}: {
  item: MenuItem;
  fallbackType: OfferingType;
  available: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const cart = useCart();
  const decision = decideAdd(item, fallbackType, { available });
  if (decision.mode === 'none') return null;

  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    fn();
  };

  if (decision.mode === 'add') {
    const quantity = cart.simpleQuantity(item.id);
    if (quantity > 0) {
      return (
        <Box
          data-testid={`guest-mosaic-counter-${item.code}`}
          onClick={(event) => event.stopPropagation()}
          sx={(theme) => ({
            flexShrink: 0,
            borderRadius: surfaceRadius.pill(theme.palette.brand.radius),
            boxShadow: mosaicTile.actionShadow,
            textShadow: 'none',
          })}
        >
          <QuantityStepper
            size="small"
            code={item.code}
            value={quantity}
            removeAtZero
            onIncrement={() => cart.addSimple(item)}
            onDecrement={() => cart.decrementSimple(item.id)}
          />
        </Box>
      );
    }
  }

  const sheet = decision.mode === 'sheet';
  const inCart = sheet
    ? cart.lines.filter((line) => line.item_id === item.id).reduce((sum, line) => sum + line.quantity, 0)
    : 0;
  return (
    <Box sx={{ position: 'relative', flexShrink: 0 }}>
      <Box
        component="button"
        type="button"
        data-testid={`guest-qty-plus-${item.code}`}
        aria-label={t(sheet ? 'guest.menu.chooseAria' : 'guest.menu.addAria', { title: item.title })}
        aria-haspopup={sheet ? 'dialog' : undefined}
        onClick={stop(sheet ? onOpen : () => cart.addSimple(item))}
        sx={(theme) => ({
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          boxShadow: mosaicTile.actionShadow,
          transition: 'transform .12s',
          '&:active': { transform: 'scale(.92)' },
          '&:focus-visible': { outline: `3px solid ${mosaicTile.focusOnMedia}`, outlineOffset: 2 },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        <AddIcon sx={{ fontSize: 22 }} />
      </Box>
      {inCart > 0 ? (
        <Box
          component="span"
          data-testid={`guest-mosaic-qty-${item.code}`}
          aria-label={t('guest.menu.inCartAria', { count: inCart })}
          sx={(theme) => ({
            position: 'absolute',
            top: -6,
            insetInlineEnd: -6,
            minWidth: 20,
            height: 20,
            px: 0.5,
            borderRadius: '10px',
            bgcolor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            fontSize: fontPx(11.5),
            fontWeight: 800,
            display: 'grid',
            placeItems: 'center',
            textShadow: 'none',
          })}
        >
          {inCart}
        </Box>
      ) : null}
    </Box>
  );
}
