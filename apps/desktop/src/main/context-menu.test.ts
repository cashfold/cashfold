import { describe, expect, it, vi } from 'vitest';
import { PopupMenuRequestSchema } from '@cashfold/platform';
import { popupContextMenu } from './context-menu';

type Template = Array<{ label: string; enabled: boolean; click: () => void }>;

function setup(options: { destroyed?: boolean; noWindow?: boolean } = {}) {
  let shown: Template = [];
  let closed: () => void = () => undefined;
  const popup = vi.fn((popupOptions: { callback: () => void }) => void (closed = popupOptions.callback));
  const buildFromTemplate = vi.fn((template: unknown) => {
    shown = template as Template;
    return { popup } as never;
  });
  const window = options.noWindow === true ? undefined : ({ isDestroyed: () => options.destroyed === true } as never);
  const deps = { menu: { buildFromTemplate }, window: () => window };
  return { deps, buildFromTemplate, popup, shown: () => shown, close: () => closed() };
}

const ITEMS = [
  { id: 'edit', label: 'Edit' },
  { id: 'pin', label: 'Pin', disabled: true },
  { id: 'delete', label: 'Delete', destructive: true },
];

describe('the row context menu', () => {
  it('pops up the labels it was given, with disabled ones disabled, and answers with the chosen id', async () => {
    const { deps, shown, popup } = setup();
    const answer = popupContextMenu(deps, ITEMS);
    expect(shown().map((item) => [item.label, item.enabled])).toEqual([['Edit', true], ['Pin', false], ['Delete', true]]);
    expect(popup).toHaveBeenCalledOnce();
    shown()[2]!.click();
    await expect(answer).resolves.toBe('delete');
  });

  it('answers null when the menu is closed without a choice', async () => {
    vi.useFakeTimers();
    const { deps, close } = setup();
    const answer = popupContextMenu(deps, ITEMS);
    close();
    await vi.runAllTimersAsync();
    await expect(answer).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('lets a click win when the system reports the close first', async () => {
    vi.useFakeTimers();
    const { deps, shown, close } = setup();
    const answer = popupContextMenu(deps, ITEMS);
    close();
    shown()[0]!.click();
    await vi.runAllTimersAsync();
    await expect(answer).resolves.toBe('edit');
    vi.useRealTimers();
  });

  it('shows nothing when there is no window, or it is gone', async () => {
    for (const options of [{ noWindow: true }, { destroyed: true }]) {
      const { deps, buildFromTemplate } = setup(options);
      await expect(popupContextMenu(deps, ITEMS)).resolves.toBeNull();
      expect(buildFromTemplate).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['an empty list', []],
    ['more than twelve items', Array.from({ length: 13 }, (_, i) => ({ id: `item-${String.fromCharCode(97 + i)}`, label: 'x' }))],
    ['an id with a capital letter', [{ id: 'Edit', label: 'Edit' }]],
    ['an id that starts with a digit', [{ id: '1edit', label: 'Edit' }]],
    ['an id longer than 24 characters', [{ id: 'a'.repeat(25), label: 'Edit' }]],
    ['a label over 60 characters', [{ id: 'edit', label: 'x'.repeat(61) }]],
    ['an empty label', [{ id: 'edit', label: '' }]],
    ['an unknown key', [{ id: 'edit', label: 'Edit', icon: 'x' }]],
  ])('refuses %s, and shows nothing', async (_name, items) => {
    expect(PopupMenuRequestSchema.safeParse({ items }).success).toBe(false);
    const { deps, buildFromTemplate } = setup();
    await expect(popupContextMenu(deps, items as never)).resolves.toBeNull();
    expect(buildFromTemplate).not.toHaveBeenCalled();
  });
});
