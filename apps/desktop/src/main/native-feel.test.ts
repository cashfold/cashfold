import { describe, expect, it, vi } from 'vitest';
import { installNativeFeel, nativeFeelCss } from './native-feel';

describe('the injected stylesheet', () => {
  const css = nativeFeelCss();

  it('stops interface text from being selected but keeps fields and copy-on-purpose values selectable', () => {
    expect(css).toMatch(/^html \{[^}]*user-select: none;/m);
    expect(css).toMatch(/input, textarea, \[contenteditable\][^{]*\[data-selectable\][^{]*\{ user-select: text;/);
  });

  it('shows the arrow on actions, the text pointer on text, the hand only on links that leave the app', () => {
    expect(css).toMatch(/button[^{]*\[role="tab"\][^{]*\{ cursor: default !important; \}/);
    expect(css).toMatch(/\[data-selectable\][^{]*\{ cursor: text !important; \}/);
    expect(css).toMatch(/input:not\(\[type\]\):not\(:disabled\)/);
    const hands = css.split('\n').filter((line) => line.includes('cursor: pointer'));
    expect(hands).toEqual(['a[target="_blank"], a[target="_blank"] * { cursor: pointer !important; }']);
  });

  it('puts the disabled rule after the text rule so a disabled control shows the arrow', () => {
    expect(css.indexOf('[aria-disabled="true"], [aria-disabled="true"] *')).toBeGreaterThan(css.indexOf('cursor: text'));
  });

  it('stops images from being dragged and the page from bouncing', () => {
    expect(css).toContain('img, svg, a { -webkit-user-drag: none; }');
    expect(css).toContain('overscroll-behavior: none');
  });

  it('has no custom drag region (the frame is not redesigned here)', () => {
    expect(css).not.toContain('app-region');
  });
});

describe('installNativeFeel', () => {
  it('injects the stylesheet in every document the window loads', () => {
    let ready: () => void = () => undefined;
    const insertCSS = vi.fn(async () => 'key');
    installNativeFeel({ on: ((event: string, listener: () => void) => { if (event === 'dom-ready') ready = listener; }) as never, insertCSS });
    ready();
    ready();
    expect(insertCSS).toHaveBeenCalledTimes(2);
    expect(insertCSS).toHaveBeenCalledWith(nativeFeelCss());
  });

  it('leaves the page alone when injecting fails', async () => {
    let ready: () => void = () => undefined;
    const insertCSS = vi.fn(async () => { throw new Error('gone'); });
    installNativeFeel({ on: ((_e: string, listener: () => void) => { ready = listener; }) as never, insertCSS });
    expect(() => ready()).not.toThrow();
    await Promise.resolve();
  });
});
