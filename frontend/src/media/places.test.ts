import { describe, expect, it } from 'vitest';

import { ROLE_PLACES, checkPlace, placeSize, roleNeedWidth } from './places';

/**
 * МЕСТА ПОКАЗА И ИХ ПРОВЕРКА (партия 58в). Та же математика, что у KitImage
 * (доля кадра) и у замера 58а/58б (растяжение при DPR 2).
 */
describe('checkPlace', () => {
  it('«целиком» с вертикальным фото в широком окне — меньше 60 %, красная метка', () => {
    // Утиная грудка 2:3 в окне позиции 878×494 (16:9).
    const check = checkPlace('whole', [878, 494], 1400, 2100);
    expect(check.share).toBeLessThan(0.6);
    expect(check.wholeShrunk).toBe(true);
    expect(check.shown).toBe('contain');
    expect(check.bad).toBe(true);
  });

  it('«заполнить» вертикальное фото не краснеет за долю — только за растяжение', () => {
    const check = checkPlace('fill', [331, 146], 1400, 2100);
    expect(check.wholeShrunk).toBe(false);
    expect(check.shown).toBe('cover');
    expect(check.stretch).toBeLessThanOrEqual(1);
    expect(check.bad).toBe(false);
  });

  it('оригинала не хватает шапке 1080×360 при DPR 2 — нужен от 2160 px', () => {
    const check = checkPlace('fill', [1080, 360], 1400, 933);
    expect(check.needWidth).toBe(2160);
    expect(check.stretch).toBeGreaterThan(1);
    expect(check.bad).toBe(true);
  });
});

describe('roleNeedWidth', () => {
  it('считается из мест роли, а не константой', () => {
    // Фон: место 1440×900 при DPR 2 — 2880 для фото 3:2; 390×844 — по высоте.
    const need = roleNeedWidth('background', 3000, 2000);
    expect(need).toBe(Math.max(2880, Math.ceil(844 * 2 * 1.5)));
  });

  it('логотип мест не имеет — порога нет', () => {
    expect(ROLE_PLACES.logo).toHaveLength(0);
    expect(roleNeedWidth('logo', 200, 80)).toBe(0);
  });

  it('окно позиции на ПК берёт высоту по форме фото в пределах 16:9…21:9', () => {
    const window = ROLE_PLACES.item.find((p) => p.key === 'window')!;
    expect(placeSize(window, 'wide', 3)).toEqual([878, Math.round(878 / (21 / 9))]);
    expect(placeSize(window, 'wide', 1)).toEqual([878, Math.round(878 / (16 / 9))]);
  });
});
