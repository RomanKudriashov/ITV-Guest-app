import { focusPosition, srcSetOf, type ImageRef } from '@/kit/imageRef';

/**
 * ПРОСТОЙ `<img>` CMS ПО ОБЪЕКТУ КАРТИНКИ (партия 58а).
 *
 * Для крупных мест CMS, которые остаются своим `<img>` (карточка заведения,
 * кадр баннера): файл выбирает браузер по `srcset`/`sizes`, кадр ложится по
 * фокусу. Раскладка места не меняется — меняются только атрибуты.
 *
 * Нет объекта (старый ответ, локальное превью `blob:`) — прежний адрес строкой.
 */
export function refImgProps(
  /** Ассет медиа или кадр баннера: всё, у чего есть адрес и, может быть, `ref`. */
  source: { url?: string; ref?: ImageRef | null },
  sizes: string,
  /** false — без `object-position` по фокусу (логотип вписан `contain` по центру). */
  focus = true,
): { src: string | undefined; srcSet?: string; sizes?: string; style?: { objectPosition: string } } {
  const { ref, url } = source;
  if (!ref || !ref.widths?.length) return { src: url };
  return {
    src: ref.src || url,
    srcSet: srcSetOf(ref),
    sizes,
    ...(focus ? { style: { objectPosition: focusPosition(ref) } } : {}),
  };
}
