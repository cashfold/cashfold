import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopStateStore, DEFAULT_DESKTOP_STATE, sanitiseDesktopState, type Display } from './desktop-state';

const SCREEN: Display = { x: 0, y: 0, width: 1920, height: 1080 };
const SECOND: Display = { x: 1920, y: 0, width: 1920, height: 1080 };

describe('sanitising the saved window state', () => {
  it('gives the defaults for missing or malformed input', () => {
    for (const raw of [undefined, null, 42, 'x', [], true]) expect(sanitiseDesktopState(raw, [SCREEN]), String(raw)).toEqual(DEFAULT_DESKTOP_STATE);
  });

  it('has sensible defaults: a window that fits, not maximised, automatic update checks on', () => {
    expect(DEFAULT_DESKTOP_STATE).toMatchObject({ width: 1280, height: 800, maximized: false, autoCheck: true, hideOnBlur: false, startAtLogin: false, theme: 'system' });
  });

  it('keeps good values', () => {
    const raw = { x: 100, y: 50, width: 1000, height: 700, maximized: true, lastCheckedAt: '2026-10-22T10:00:00.000Z', autoCheck: false };
    expect(sanitiseDesktopState(raw, [SCREEN])).toMatchObject(raw);
  });

  it('drops non-finite and non-integer numbers', () => {
    const state = sanitiseDesktopState({ x: Number.NaN, y: 1.5, width: Number.POSITIVE_INFINITY, height: '700' }, [SCREEN]);
    expect(state).toEqual(DEFAULT_DESKTOP_STATE);
  });

  it('clamps width and height to at least 800 by 600', () => {
    expect(sanitiseDesktopState({ width: 100, height: 50 }, [SCREEN])).toMatchObject({ width: 800, height: 600 });
    expect(sanitiseDesktopState({ width: -5, height: 0 }, [SCREEN])).toMatchObject({ width: 800, height: 600 });
  });

  it('keeps a window that fits on a connected display where it was', () => {
    expect(sanitiseDesktopState({ x: 2000, y: 100, width: 1000, height: 700 }, [SCREEN, SECOND])).toMatchObject({ x: 2000, y: 100 });
  });

  it('moves a window whose display is gone fully onto a connected display', () => {
    const state = sanitiseDesktopState({ x: 2000, y: 100, width: 1000, height: 700 }, [SCREEN]);
    expect(state.x).toBeDefined();
    expect(state.x! >= SCREEN.x && state.x! + state.width <= SCREEN.x + SCREEN.width).toBe(true);
    expect(state.y! >= SCREEN.y && state.y! + state.height <= SCREEN.y + SCREEN.height).toBe(true);
  });

  it('pulls back a window that hangs off the edge of a display', () => {
    const state = sanitiseDesktopState({ x: 1500, y: 900, width: 1000, height: 700 }, [SCREEN]);
    expect(state.x! + state.width).toBeLessThanOrEqual(1920);
    expect(state.y! + state.height).toBeLessThanOrEqual(1080);
    expect(state.x).toBeGreaterThanOrEqual(0);
  });

  it('shrinks a window larger than the display it lands on', () => {
    const state = sanitiseDesktopState({ x: 0, y: 0, width: 5000, height: 4000 }, [SCREEN]);
    expect(state.width).toBeLessThanOrEqual(1920);
    expect(state.height).toBeLessThanOrEqual(1080);
  });

  it('lets the system place the window when no display is known', () => {
    const state = sanitiseDesktopState({ x: 10, y: 10, width: 1000, height: 700 }, []);
    expect(state).not.toHaveProperty('x');
    expect(state).not.toHaveProperty('y');
  });

  it('keeps maximized only if it is a boolean', () => {
    expect(sanitiseDesktopState({ maximized: true }, [SCREEN]).maximized).toBe(true);
    expect(sanitiseDesktopState({ maximized: 'yes' }, [SCREEN]).maximized).toBe(false);
    expect(sanitiseDesktopState({ maximized: 1 }, [SCREEN]).maximized).toBe(false);
  });

  it('keeps lastCheckedAt only as an ISO date string', () => {
    expect(sanitiseDesktopState({ lastCheckedAt: '2026-10-22T10:00:00.000Z' }, [SCREEN]).lastCheckedAt).toBe('2026-10-22T10:00:00.000Z');
    for (const bad of ['yesterday', 12345, '2026-13-45T00:00:00Z', '', null, {}]) expect(sanitiseDesktopState({ lastCheckedAt: bad }, [SCREEN]), String(bad)).not.toHaveProperty('lastCheckedAt');
  });

  it('keeps autoCheck only if it is a boolean, otherwise on', () => {
    expect(sanitiseDesktopState({ autoCheck: false }, [SCREEN]).autoCheck).toBe(false);
    expect(sanitiseDesktopState({ autoCheck: true }, [SCREEN]).autoCheck).toBe(true);
    for (const bad of ['false', 0, null, undefined, {}]) expect(sanitiseDesktopState({ autoCheck: bad }, [SCREEN]).autoCheck, String(bad)).toBe(true);
  });

  it('drops unknown keys, including dangerous ones', () => {
    const raw = JSON.parse('{"width":900,"height":700,"extra":1,"__proto__":{"polluted":true},"constructor":"x"}') as unknown;
    const state = sanitiseDesktopState(raw, [SCREEN]);
    expect(Object.keys(state).sort()).toEqual(['autoCheck', 'closeBehavior', 'height', 'hideOnBlur', 'maximized', 'startAtLogin', 'theme', 'width']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('the state file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'desktop-state-'));
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('starts from the defaults when there is no file', () => {
    expect(createDesktopStateStore(join(dir, 'desktop-state.json'), () => [SCREEN]).get()).toEqual(DEFAULT_DESKTOP_STATE);
  });

  it('starts from the defaults when the file is not JSON', () => {
    const file = join(dir, 'desktop-state.json');
    writeFileSync(file, '{ not json');
    expect(createDesktopStateStore(file, () => [SCREEN]).get()).toEqual(DEFAULT_DESKTOP_STATE);
  });

  it('saves after a pause, once, with the last values', () => {
    const file = join(dir, 'desktop-state.json');
    const store = createDesktopStateStore(file, () => [SCREEN], 500);
    store.update({ width: 900 });
    store.update({ width: 1000, maximized: true });
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ width: 1000, maximized: true });
  });

  it('flushes on demand and leaves no temporary file behind', () => {
    const file = join(dir, 'desktop-state.json');
    const store = createDesktopStateStore(file, () => [SCREEN], 500);
    store.update({ autoCheck: false });
    store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ autoCheck: false });
    expect(readdirSync(dir)).toEqual(['desktop-state.json']);
  });

  it('reloads what it saved', () => {
    const file = join(dir, 'desktop-state.json');
    const first = createDesktopStateStore(file, () => [SCREEN]);
    first.update({ width: 1111, lastCheckedAt: '2026-10-22T10:00:00.000Z' });
    first.flush();
    expect(createDesktopStateStore(file, () => [SCREEN]).get()).toMatchObject({ width: 1111, lastCheckedAt: '2026-10-22T10:00:00.000Z' });
  });

  it('does not throw when the file cannot be written', () => {
    const store = createDesktopStateStore(join(dir, 'missing-folder', 'x', 'desktop-state.json'), () => [SCREEN]);
    store.update({ width: 900 });
    expect(() => store.flush()).not.toThrow();
  });
});
