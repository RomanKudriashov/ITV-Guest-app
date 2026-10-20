import { describe, expect, it } from 'vitest';

import {
  backgroundImageSx,
  cappedSizes,
  densityCap,
  MAX_BACKGROUND_WIDTH,
  coverWidth,
  focusPosition,
  IMAGE_SET_SUPPORTS,
  imageSetCss,
  MIN_VISIBLE_SHARE,
  pickWidth,
  srcSetOf,
  visibleShare,
  type ImageRef,
} from './imageRef';

const ref = (w: number, h: number, widths = [400, 800, 1200, 1600, 2400]): ImageRef => ({
  src: `/w800.webp`,
  widths: widths.map((x) => ({ w: x, url: `/w${x}.webp` })),
  w,
  h,
  focus: { x: 0.25, y: 0.8 },
  color: null,
  luminance: 0.3,
});

describe('srcset и выбор ширины', () => {
  it('srcset перечисляет все ширины с дескрипторами w', () => {
    expect(srcSetOf(ref(3624, 1510))).toBe(
      '/w400.webp 400w, /w800.webp 800w, /w1200.webp 1200w, /w1600.webp 1600w, /w2400.webp 2400w',
    );
  });

  it('берётся наименьшая ширина не уже нужной, иначе самая широкая', () => {
    expect(pickWidth(ref(3624, 1510), 801)?.w).toBe(1200);
    expect(pickWidth(ref(3624, 1510), 400)?.w).toBe(400);
    expect(pickWidth(ref(1280, 853, [400, 800, 1200]), 2880)?.w).toBe(1200);
  });

  it('фокус становится object-position в процентах', () => {
    expect(focusPosition(ref(10, 10))).toBe('25% 80%');
  });
});

describe('видимая доля и предел обрезки', () => {
  it('окно «House rules»: панорама 2,4:1 в колонке 400×792 — видно ~21%', () => {
    const share = visibleShare(ref(3624, 1510), 400, 792);
    expect(share).toBeCloseTo(0.21, 2);
    expect(share).toBeLessThan(MIN_VISIBLE_SHARE);
  });

  it('карточка 1,5:1 в месте 16:9 — видно больше 60%, режется как прежде', () => {
    expect(visibleShare(ref(1500, 1000), 1600, 900)).toBeGreaterThan(MIN_VISIBLE_SHARE);
  });

  it('без формы кадра судить не о чем — видно всё', () => {
    expect(visibleShare({ w: null, h: null }, 400, 800)).toBe(1);
  });

  it('cover-месту нужна ширина по оси, которой не хватает', () => {
    // фон 2,4:1 на телефоне 390×844: высота решает — 844 × 2,4 ≈ 2026
    expect(Math.round(coverWidth(ref(2400, 1000), 390, 844))).toBe(2026);
    expect(coverWidth(ref(1000, 1000), 1440, 900)).toBe(1440);
  });
});

describe('фон через image-set', () => {
  it('1x и 2x под ширину места', () => {
    expect(imageSetCss(ref(3840, 1600), 1080)).toBe('image-set(url("/w1200.webp") 1x, url("/w2400.webp") 2x)');
  });

  it('одна ширина на обе плотности — одно объявление', () => {
    expect(imageSetCss(ref(400, 300, [400]), 1080)).toBe('image-set(url("/w400.webp") 1x)');
  });

  it('sx: простой url (запасной), image-set — под @supports, не массивом', () => {
    const sx = backgroundImageSx(ref(3840, 1600), 1080);
    // Массив в sx — значения по брейкпойнтам: до 600 px image-set не действовал.
    expect(Array.isArray(sx.backgroundImage)).toBe(false);
    expect(sx.backgroundImage).toBe('url("/w2400.webp")');
    expect(sx[IMAGE_SET_SUPPORTS].backgroundImage).toContain('image-set(');
  });
});

describe('потолок плотности и ширины фона (партия 61)', () => {
  it('плотность 3 считается как 2, плотность 1 и 2 — как есть', () => {
    expect(densityCap(3)).toBeCloseTo(2 / 3);
    expect(densityCap(2)).toBe(1);
    expect(densityCap(1)).toBe(1);
  });

  it('sizes на плотности 3 сжимается до ширины под ×2, условия сохраняются', () => {
    expect(cappedSizes('(min-width: 1024px) 400px, 100vw', 2 / 3)).toBe(
      '(min-width: 1024px) calc(400px * 0.6667), calc(100vw * 0.6667)',
    );
    expect(cappedSizes('100vw', 1)).toBe('100vw');
  });

  it('фон бренда не шире потолка даже под ×2 высокого телефона', () => {
    const wide = ref(3840, 2160, [400, 800, 1200, 1600, 2400, 3200, 3840]);
    // 390×844, cover по высоте: 844 × 16/9 = 1500 CSS px, ×2 — 3000 → без потолка 3200.
    expect(imageSetCss(wide, 1500)).toContain('/w3200.webp');
    const capped = imageSetCss(wide, 1500, MAX_BACKGROUND_WIDTH);
    expect(capped).toContain('/w2400.webp');
    expect(capped).not.toContain('/w3200.webp');
    expect(backgroundImageSx(wide, 1500, MAX_BACKGROUND_WIDTH).backgroundImage).toBe('url("/w2400.webp")');
  });
});
