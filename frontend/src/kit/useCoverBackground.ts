import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { backgroundImageSx, coverWidth, focusPosition, MAX_BACKGROUND_WIDTH, type ImageRef } from './imageRef';

/**
 * ФОН ПО ШИРИНЕ МЕСТА (партия 58а) — для мест, где фото лежит фоном (шапка
 * заведения, обложка главной, фон бренда), а не `<img>`.
 *
 * Хук меряет элемент и отдаёт `image-set` под ширину, которой `cover`-месту
 * действительно хватит (по оси, которой не хватает), плюс положение по фокусу и
 * подложку средним цветом. Без объекта картинки — `null`: место рисует свой
 * прежний фон (адрес строкой, градиент бренда).
 *
 *     const bg = useCoverBackground(venue.image_ref);
 *     <Box ref={bg.ref} sx={{ ...bg.sx, backgroundSize: 'cover' }} />
 */
export function useCoverBackground<T extends HTMLElement = HTMLDivElement>(
  image?: ImageRef | null,
  options: {
    /**
     * Фон БРЕНДА (партия 61): ширина — от окна, а не от места. Один кадр бренда
     * рисуют фон страницы, шапка витрины и экран входа; каждое место мерило
     * себя и брало свою ширину — на одном экране качались 1200, 1600 и 2400
     * одного фото. От окна у всех мест один и тот же файл.
     */
    viewport?: boolean;
  } = {},
) {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const { viewport = false } = options;

  useLayoutEffect(() => {
    const node = ref.current;
    if (viewport) {
      if (typeof window === 'undefined' || !image) return undefined;
      const measure = () => setBox({ w: window.innerWidth, h: window.innerHeight });
      measure();
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    if (!node || !image) return undefined;
    const measure = () => setBox({ w: node.clientWidth, h: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [image, viewport]);

  if (!image || !image.widths.length) return { ref, sx: null as null | Record<string, unknown> };
  // До замера — ширина окна: первый кадр не должен ждать ResizeObserver.
  const width = box.w > 0 ? coverWidth(image, box.w, box.h) : typeof window !== 'undefined' ? window.innerWidth : 1080;
  const sx: Record<string, unknown> = {
    // Фон — с потолком ширины (под вуалью 3840 не видно); остальные места — по месту.
    ...backgroundImageSx(image, width, viewport ? MAX_BACKGROUND_WIDTH : Infinity),
    backgroundPosition: focusPosition(image),
    ...(image.color ? { backgroundColor: image.color as CSSProperties['backgroundColor'] } : {}),
  };
  return { ref, sx };
}
