import { describe, expect, it } from 'vitest';

import { flowTint, type PlanReading } from './RoomPlanPlate';

// Цвет потока по режиму и градация по температуре (партия 65).
const palette = { tint: '150,195,255', cool: ['200,228,255', '25,105,255'] as [string, string], heat: ['255,190,150', '255,70,50'] as [string, string], fan: '196,202,212' };
const base: PlanReading = { title: '', on: true, fan: 1, air: true, pending: false, disabled: false };
const blue = (tint: string) => Number(tint.split(',')[0]);
const red = (tint: string) => Number(tint.split(',')[1]);

describe('flowTint', () => {
  it('вентилятор — серый, без режима — прежний цвет', () => {
    expect(flowTint({ ...base, mode: 'fan', setpoint: 18, current: 25 }, palette)).toBe(palette.fan);
    expect(flowTint({ ...base, mode: null }, palette)).toBe(palette.tint);
  });

  it('охлаждение тем глубже, чем больше разница уставки и температуры', () => {
    const soft = flowTint({ ...base, mode: 'cool', setpoint: 22, current: 23 }, palette);
    const deep = flowTint({ ...base, mode: 'cool', setpoint: 18, current: 23 }, palette);
    expect(blue(deep)).toBeLessThan(blue(soft) - 60);
  });

  it('нагрев тем краснее, чем больше разница; без текущей — по уставке', () => {
    const soft = flowTint({ ...base, mode: 'heat', setpoint: 24, current: 23 }, palette);
    const deep = flowTint({ ...base, mode: 'heat', setpoint: 28, current: 23 }, palette);
    expect(red(deep)).toBeLessThan(red(soft) - 50);
    expect(red(flowTint({ ...base, mode: 'heat', setpoint: 28, current: null }, palette))).toBeLessThan(red(flowTint({ ...base, mode: 'heat', setpoint: 21, current: null }, palette)));
  });
});
