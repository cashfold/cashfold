import { describe, expect, it } from 'vitest';
import { ITEM_ROW_PROPS, requestedItem, withoutItem } from './item-focus';

describe('opening a budget or goal from the palette', () => {
  it('asks for the item only when the list has it', () => {
    expect(requestedItem('view=goals&item=g1', ['g0', 'g1'])).toBe('g1');
    expect(requestedItem('view=goals&item=gone', ['g0', 'g1'])).toBeUndefined();
    expect(requestedItem('view=goals', ['g0'])).toBeUndefined();
    expect(requestedItem('', [])).toBeUndefined();
  });

  it('takes only the item out of the address', () => {
    expect(withoutItem('/plan/', 'view=goals&item=g1')).toBe('/plan/?view=goals');
    expect(withoutItem('/plan/', 'item=g1&view=budgets')).toBe('/plan/?view=budgets');
    expect(withoutItem('/plan/', 'item=g1')).toBe('/plan/');
  });

  it('marks a row so the view can find it and focus it', () => {
    expect(ITEM_ROW_PROPS('b1')).toEqual({ 'data-item-id': 'b1', tabIndex: -1 });
  });
});
