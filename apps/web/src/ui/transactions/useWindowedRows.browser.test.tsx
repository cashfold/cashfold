import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useWindowedBlock } from './useWindowedRows';

// The windowing hook in a real browser: far blocks are empty but keep their height, and blocks fill in as they are scrolled to.

let root: Root | undefined;
let host: HTMLElement | undefined;

function Block({ index }: { index: number }) {
  const { ref, rendered } = useWindowedBlock<HTMLElement>(index < 2, 300);
  return <section ref={ref} data-testid={`block-${index}`}>{rendered ? <div data-content style={{ height: 300 }}>block {index}</div> : null}</section>;
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('useWindowedBlock', () => {
  it('renders only the blocks near the viewport, keeps the full scroll height, and fills in blocks as they are reached', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(<>{Array.from({ length: 200 }, (_, i) => <Block key={i} index={i} />)}</>));
    await wait(200);

    const rendered = () => host!.querySelectorAll('[data-content]').length;
    expect(rendered()).toBeLessThan(20); // 200 blocks exist, only those within the margin are rendered
    expect(rendered()).toBeGreaterThan(0);
    expect(host.querySelector('[data-testid=block-199]')!.childElementCount).toBe(0);
    expect(host.getBoundingClientRect().height).toBeGreaterThan(200 * 300 - 1); // the placeholders hold the room

    host.querySelector('[data-testid=block-199]')!.scrollIntoView();
    await wait(300);
    expect(host.querySelector('[data-testid=block-199] [data-content]')).not.toBeNull();
    expect(host.querySelector('[data-testid=block-0]')!.childElementCount).toBe(0); // the first ones were dropped once far away
    expect(rendered()).toBeLessThan(20);
  });
});
