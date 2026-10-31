import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createTranslator, ENGLISH } from '../i18n/i18n';
import { PaletteHistorySectionView } from './PaletteHistorySection';

const t = createTranslator('en');
const render = (cleared: boolean, onClear = () => undefined) => renderToStaticMarkup(<PaletteHistorySectionView t={t} cleared={cleared} onClear={onClear} />);

describe('Settings → clear palette history', () => {
  it('says what it forgets and that the data is not touched, and offers one button', () => {
    const html = render(false);
    expect(html).toContain(ENGLISH['palette.history.heading']);
    expect(html).toContain('Your data is not touched.');
    expect(html).toContain(ENGLISH['palette.history.clear']);
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('says in a status line what was cleared, only once it was', () => {
    expect(render(false)).not.toContain(ENGLISH['palette.history.cleared']);
    expect(render(true)).toContain(ENGLISH['palette.history.cleared']);
    expect(render(true)).toContain('role="status"');
  });

  it('is wired to the button', () => {
    const onClear = vi.fn();
    const element = PaletteHistorySectionView({ t, cleared: false, onClear });
    expect(JSON.stringify(element, (_, v) => (typeof v === 'function' ? 'fn' : v))).toContain('palette-history-clear');
  });
});
