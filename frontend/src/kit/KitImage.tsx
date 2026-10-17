import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { alpha, type Theme } from '@mui/material/styles';

import { IconRestaurant, type AppIconComponent } from '@/icons';
import { fadeInSx } from './motion';
import { coverWidth, focusPosition, MIN_VISIBLE_SHARE, srcSetOf, visibleShare, type ImageRef } from './imageRef';

/**
 * The storefront's single image primitive.
 *
 * Every picture in the storefront goes through here so the four concerns live in
 * one place: it lazy-loads (`loading="lazy"`), shows a shimmer skeleton until the
 * bytes arrive, holds a fixed aspect ratio so nothing reflows, and — when there
 * is no image — paints a DESIGNED fallback: a monochrome section/type icon on a
 * textured token surface with depth, never a flat coloured circle. Colours come
 * only from theme tokens.
 */
export type KitImageFit = 'fill' | 'whole';

export interface KitImageProps {
  /**
   * Объект картинки (партия 58а): ряд ширин, форма кадра, фокус, цвет. Есть —
   * файл выбирает браузер по `srcset`/`sizes`, кадр ложится по фокусу.
   */
  image?: ImageRef | null;
  /** Адрес строкой — для мест, где объекта нет (логотип в токенах, старые клиенты). */
  src?: string | null;
  /**
   * Ширина места для выбора файла — ЗАДАЁТ МЕСТО (`'(min-width: 1024px) 400px, 100vw'`).
   * Без неё браузер считает место во весь экран и тянет лишнее.
   */
  sizes?: string;
  /**
   * ТИП МЕСТА — выбирает каждое место явно (партия 58а, решение тек-лида по
   * снимкам карточек меню: узкая полоса блюда на размытом фоне — плохо).
   *
   * - `fill` — «заполнить»: карточки позиций, плитки, мозаика, шапки, значки.
   *   ВСЕГДА `cover` по фокусу, без размытого фона, при любой доле.
   * - `whole` — «показать целиком»: окна позиции и инфо, баннеры, крупный
   *   просмотр. Видно меньше 60% кадра — фото целиком поверх размытого себя.
   */
  fit: KitImageFit;
  alt: string;
  /** CSS aspect-ratio (e.g. `'16 / 9'`). Ignored when `fill` is set. */
  ratio?: string;
  /** Fill a positioned parent (`position: absolute; inset: 0`) instead of owning a ratio box. */
  fill?: boolean;
  /** Icon drawn on the fallback surface — pick a section/type icon per item. */
  fallbackIcon?: AppIconComponent;
  /** Fallback icon size (px). */
  fallbackIconSize?: number;
  /** Corner radius (px). Defaults to no rounding (parent usually clips). */
  radius?: number;
  testId?: string;
}

/** Textured token surface used behind a missing image — soft gradient + depth. */
export function mediaFallbackSx(theme: Theme) {
  const soft = theme.palette.brand.primarySoft;
  const line = theme.palette.divider;
  return {
    backgroundColor: theme.palette.brand.surfaceMuted,
    backgroundImage: [
      `radial-gradient(130% 120% at 18% 12%, ${soft}, transparent 55%)`,
      `radial-gradient(120% 130% at 100% 100%, ${alpha(theme.palette.primary.main, 0.06)}, transparent 60%)`,
      `repeating-linear-gradient(135deg, ${alpha(line, 0.5)} 0 1px, transparent 1px 13px)`,
    ].join(','),
    boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.04)}, inset 0 0 40px -18px ${theme.palette.brand.scrim}`,
  } as const;
}

export function KitImage({
  image,
  src: srcProp,
  sizes = '100vw',
  fit,
  alt,
  ratio = '16 / 9',
  fill = false,
  fallbackIcon: FallbackIcon = IconRestaurant,
  fallbackIconSize = 40,
  radius,
  testId,
}: KitImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const src = image?.src || srcProp || null;

  /*
    ПРЕДЕЛ ОБРЕЗКИ (партия 58а) — только у мест `whole`. Место меряется само
    (ResizeObserver): форма места против формы кадра даёт видимую долю. Меньше
    60% — `cover` отрезал бы больше, чем показал (окно «House rules»: 21%), и
    фото ложится целиком (`contain`) поверх размытого себя. Места `fill`
    режутся по фокусу всегда. Форма кадра — из объекта; строкой пришедшую
    картинку не судим.
  */
  const [share, setShare] = useState(1);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node || !image?.w || !image?.h) {
      setShare(1);
      return undefined;
    }
    const measure = () => {
      setBox({ w: node.clientWidth, h: node.clientHeight });
      setShare(visibleShare(image, node.clientWidth, node.clientHeight));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [image]);
  const whole = fit === 'whole' && share < MIN_VISIBLE_SHARE;
  /*
    `sizes` места — ширина места; но `cover` в узком месте режет по ВЫСОТЕ и
    требует файл шире места (окно инфо 388×224 при кадре 2,4:1 — 1080 точек, а
    не 776). Измерив место, считаем нужную ширину сами; до замера — `sizes` места.
  */
  const effectiveSizes =
    image?.w && image?.h && box.w > 0 && box.h > 0
      ? `${Math.ceil(whole ? Math.min(box.w, box.h * (image.w / image.h)) : coverWidth(image, box.w, box.h))}px`
      : sizes;
  const backdropSrc = image?.widths[0]?.url ?? null;

  /*
    КАРТИНКА ИЗ КЭША УСПЕВАЕТ ЗАГРУЗИТЬСЯ ДО ТОГО, КАК РЕАКТ ПОВЕСИТ `onLoad`.

    Так на витрине и появлялись чёрные плитки: название на месте, кадр
    загружен целиком — и невидим. Проверено на стенде, двадцать кругов
    «главная → заведение → назад»: у пустых плиток `naturalWidth=600`,
    `complete=true`, сервер 200 `image/webp` нужного размера, ни одного
    неудачного запроса. То есть пиксели БЫЛИ, а `opacity` оставалась нулём,
    потому что событие загрузки прошло мимо обработчика.

    Чаще всего это случалось после возврата назад — там кэш уже тёплый, и
    гонка выигрывается браузером почти всегда. Отсюда и «иногда»: на холодном
    кэше загрузка занимает время, и обработчик успевает.

    Поэтому состояние берётся не только из события, но и СПРАШИВАЕТСЯ У САМОГО
    ЭЛЕМЕНТА: `complete && naturalWidth > 0` значит «уже нарисована», и ждать
    события нечего — его не будет.
  */
  useEffect(() => {
    setErrored(false);
    const node = imgRef.current;
    if (node?.complete && node.naturalWidth > 0) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
  }, [src]);

  const showImage = Boolean(src) && !errored;

  const frameSx = fill
    ? ({ position: 'absolute', inset: 0 } as const)
    : ({ position: 'relative', width: '100%', aspectRatio: ratio } as const);

  return (
    <Box
      ref={frameRef}
      data-testid={testId}
      data-fit={showImage ? (whole ? 'contain' : 'cover') : undefined}
      data-visible-share={showImage && image ? share.toFixed(2) : undefined}
      sx={{
        ...frameSx,
        overflow: 'hidden',
        ...(radius != null ? { borderRadius: `${radius}px` } : {}),
        // Средний цвет — подложка, пока файл грузится, и под фото целиком.
        ...(image?.color ? { backgroundColor: image.color } : {}),
      }}
    >
      {showImage ? (
        <>
          {/* Skeleton shimmer sits under the image until it decodes. */}
          {!loaded ? (
            <Box
              aria-hidden
              sx={(theme) => ({
                position: 'absolute',
                inset: 0,
                bgcolor: theme.palette.brand.surfaceMuted,
                '@keyframes kitPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } },
                animation: 'kitPulse 1.4s ease-in-out infinite',
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              })}
            />
          ) : null}
          {whole && backdropSrc ? (
            /*
              Размытое то же фото под целым. Самая узкая ширина: после размытия
              деталей не видно, а байты — те же. При `prefers-reduced-transparency`
              размытия нет — остаётся подложка средним цветом.
            */
            <Box
              aria-hidden
              component="img"
              data-testid={testId ? `${testId}-backdrop` : 'kit-image-backdrop'}
              src={backdropSrc}
              alt=""
              loading="lazy"
              decoding="async"
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(24px) saturate(1.2)',
                transform: 'scale(1.15)',
                opacity: 0.85,
                '@media (prefers-reduced-transparency: reduce)': { display: 'none' },
              }}
            />
          ) : null}
          <Box
            component="img"
            ref={imgRef}
            src={src as string}
            srcSet={image && image.widths.length ? srcSetOf(image) : undefined}
            sizes={image && image.widths.length ? effectiveSizes : undefined}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            sx={[
              {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: whole ? 'contain' : 'cover',
                objectPosition: image && !whole ? focusPosition(image) : '50% 50%',
                opacity: loaded ? 1 : 0,
              },
              loaded ? fadeInSx() : {},
            ]}
          />
        </>
      ) : (
        <Box
          aria-hidden
          sx={(theme) => ({
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: theme.palette.brand.textTertiary,
            ...mediaFallbackSx(theme),
          })}
        >
          <FallbackIcon size={fallbackIconSize} />
        </Box>
      )}
    </Box>
  );
}
