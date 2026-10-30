import { describe, expect, it } from 'vitest';

import { climateAction } from './climate';

// Режим — не действие (партия 65): клапаны ведёт контроллер по уставке.
describe('climateAction', () => {
  it('охлаждение холодит, только когда в номере теплее уставки', () => {
    expect(climateAction('cool', 30, 23)).toBe('idle-cool');
    expect(climateAction('cool', 22, 23)).toBe('cooling');
    expect(climateAction('cool', 23, 23.4)).toBe('idle-cool');
  });
  it('нагрев греет, только когда в номере холоднее уставки', () => {
    expect(climateAction('heat', 18, 23)).toBe('idle-heat');
    expect(climateAction('heat', 26, 23)).toBe('heating');
  });
  it('авто выбирает сам, в зоне ±1° держит', () => {
    expect(climateAction('auto', 24, 26)).toBe('cooling');
    expect(climateAction('auto', 24, 22)).toBe('heating');
    expect(climateAction('auto', 24, 24.6)).toBe('holding');
  });
  it('вентилятор — вентиляция, режима нет — неизвестно', () => {
    expect(climateAction('fan', 18, 30)).toBe('fan');
    expect(climateAction(null, 22, 23)).toBe('unknown');
  });
});
