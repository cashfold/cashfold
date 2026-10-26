import { describe, expect, it, vi } from 'vitest';
import { buildMenu } from './menu';

describe('the application menu', () => {
  it('is none on Windows and Linux', () => {
    const buildFromTemplate = vi.fn();
    expect(buildMenu({ menu: { buildFromTemplate }, isMac: false })).toBeNull();
    expect(buildFromTemplate).not.toHaveBeenCalled();
  });

  it('is only the menu named after the app on macOS, with About, Hide and Quit', () => {
    const buildFromTemplate = vi.fn((template: unknown) => template as never);
    buildMenu({ menu: { buildFromTemplate }, isMac: true });
    const template = buildFromTemplate.mock.calls[0]![0] as Array<{ label: string; submenu: Array<{ role?: string; type?: string }> }>;
    expect(template).toHaveLength(1);
    expect(template[0]!.label).toBe('Cashfold');
    expect(template[0]!.submenu.map((item) => item.role ?? item.type)).toEqual(['about', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit']);
  });
});
