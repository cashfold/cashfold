import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_VISIBLE, StatusRegion, statusReducer, type StatusItem } from './StatusProvider';

const item = (id: number, message = `m${id}`): StatusItem => ({ id, message });

describe('statusReducer', () => {
  it('queues messages in order', () => {
    expect(statusReducer(statusReducer([], { type: 'add', item: item(1) }), { type: 'add', item: item(2) })).toEqual([item(1), item(2)]);
  });
  it('dismisses one message by id and ignores an unknown id', () => {
    const two = [item(1), item(2)];
    expect(statusReducer(two, { type: 'dismiss', id: 1 })).toEqual([item(2)]);
    expect(statusReducer(two, { type: 'dismiss', id: 9 })).toEqual(two);
  });
  it('keeps only the newest few so a flood cannot fill the screen', () => {
    let items: readonly StatusItem[] = [];
    for (let i = 1; i <= MAX_VISIBLE + 2; i++) items = statusReducer(items, { type: 'add', item: item(i) });
    expect(items.map((i) => i.id)).toEqual([3, 4, 5]);
  });
});

describe('StatusRegion', () => {
  const render = (items: readonly StatusItem[]) => renderToStaticMarkup(<StatusRegion items={items} dismissLabel="Dismiss" onDismiss={() => undefined} />);
  it('is a polite live region even when empty, so later messages are announced', () => {
    const html = render([]);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
  it('shows each message with a named dismiss button and takes no focus', () => {
    const html = render([item(1, 'Transaction saved')]);
    expect(html).toContain('Transaction saved');
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).not.toContain('autofocus');
    expect(html).not.toContain('tabindex');
  });
});
