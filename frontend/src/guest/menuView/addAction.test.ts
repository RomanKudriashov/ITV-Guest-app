import { describe, expect, it } from 'vitest';

import { decideAdd } from './addAction';

const group = (is_required: boolean) => ({
  id: 'g',
  code: 'g',
  title: 'g',
  selection: 'single' as const,
  is_required,
  min_choices: 0,
  max_choices: 1,
  options: [{ id: 'o', code: 'o', title: 'o', price_delta: 0 }],
});

describe('decideAdd — «+» сразу или карточка', () => {
  const on = { available: true };

  it('простое блюдо — сразу в корзину', () => {
    expect(decideAdd({ type: 'product' }, 'product', on)).toEqual({ mode: 'add', reason: null });
  });

  it('обязательные модификаторы — карточка', () => {
    expect(decideAdd({ has_required_modifiers: true, has_modifiers: true }, 'product', on).mode).toBe('sheet');
  });

  it('НЕОБЯЗАТЕЛЬНЫЕ модификаторы — тоже карточка (по флагу и по группам)', () => {
    expect(decideAdd({ has_modifiers: true, has_required_modifiers: false }, 'product', on)).toEqual({
      mode: 'sheet',
      reason: 'options',
    });
    expect(decideAdd({ modifier_groups: [group(false)] }, 'product', on).mode).toBe('sheet');
  });

  it('пустая группа модификаторов выбора не даёт', () => {
    expect(decideAdd({ modifier_groups: [{ ...group(false), options: [] }] }, 'product', on).mode).toBe('add');
  });

  it('поля заявки и слоты — карточка со своей причиной', () => {
    expect(decideAdd({ type: 'service_request' }, 'product', on)).toEqual({ mode: 'sheet', reason: 'fields' });
    expect(decideAdd({ type: 'product', has_fields: true }, 'product', on).reason).toBe('fields');
    expect(decideAdd({ type: 'slot' }, 'product', on)).toEqual({ mode: 'sheet', reason: 'slot' });
  });

  it('недоступное и инфо — без «+»', () => {
    expect(decideAdd({ type: 'product' }, 'product', { available: false }).mode).toBe('none');
    expect(decideAdd({ type: 'info' }, 'product', on).mode).toBe('none');
  });

  it('слот, закрытый только по часам, бронируется на потом', () => {
    expect(decideAdd({ type: 'slot' }, 'slot', { available: false, bookAhead: true }).mode).toBe('sheet');
    expect(decideAdd({ type: 'product' }, 'product', { available: false, bookAhead: true }).mode).toBe('none');
  });

  it('тип берётся из каталога, если у позиции свой не пришёл', () => {
    expect(decideAdd({}, 'slot', on).reason).toBe('slot');
  });
});
