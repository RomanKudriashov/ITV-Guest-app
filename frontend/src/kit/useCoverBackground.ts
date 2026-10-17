import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { backgroundImageSx, coverWidth, focusPosition, type ImageRef } from './imageRef';

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
export function useCoverBackground<T extends HTMLElement = HTMLDivElement>(image?: ImageRef | null) {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !image) return undefined;
    const measure = () => setBox({ w: node.clientWidth, h: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [image]);

  if (!image || !image.widths.length) return { ref, sx: null as null | Record<string, unknown> };
  // До замера — ширина окна: первый кадр не должен ждать ResizeObserver.
  const width = box.w > 0 ? coverWidth(image, box.w, box.h) : typeof window !== 'undefined' ? window.innerWidth : 1080;
  const sx: Record<string, unknown> = {
    ...backgroundImageSx(image, width),
    backgroundPosition: focusPosition(image),
    ...(image.color ? { backgroundColor: image.color as CSSProperties['backgroundColor'] } : {}),
  };
  return { ref, sx };
}
