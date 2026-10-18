import { describe, expect, it } from 'vitest';

import { ROLE_PLACES, checkPlace, placeSize, roleNeedWidth } from './places';

/**
 * МЕСТА ПОКАЗА И ИХ ПРОВЕРКА (партия 58в). Та же математика, что у KitImage
 * (доля кадра) и у замера 58а/58б (растяжение при DPR 2).
 */
describe('checkPlace', () => {
  it('вертикальное фото в окне — доля подписью, без красного: у гостя всё «заполнить» (58б, откат)', () => {
    // Утиная грудка 2:3 в колонке окна 458×600 и в карточке 331×146.
    const window = checkPlace('fill', [458, 600], 1400, 2100)
    expect(window.share).toBeGreaterThan(0)
    expect(window.bad).toBe(false)
    const card = checkPlace('fill', [331, 146], 1400, 2100)
    expect(card.share).toBeLessThan(0.6)
    expect(card.bad, 'малая доля — не ошибка').toBe(false)
  });

  it('у гостя нет мест «целиком» — ни в одной роли', () => {
    for (const places of Object.values(ROLE_PLACES)) for (const place of places) expect(place.fit).toBe('fill');
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

  it('ни одно место на ПК не шире 3:1 — и баннер (партия 58в, доводка)', () => {
    for (const places of Object.values(ROLE_PLACES))
      for (const place of places) if (place.wide) expect(place.wide[0] / place.wide[1], place.key).toBeLessThanOrEqual(3.01);
  });

  it('логотип мест не имеет — порога нет', () => {
    expect(ROLE_PLACES.logo).toHaveLength(0);
    expect(roleNeedWidth('logo', 200, 80)).toBe(0);
  });

  it('окно позиции на ПК — колонка слева 44 % окна 1040', () => {
    const window = ROLE_PLACES.item.find((p) => p.key === 'window')!;
    expect(placeSize(window, 'wide', 1.5)).toEqual([458, 600]);
  });
});
