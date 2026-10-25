import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { defaultSettings, sanitiseSettings, type DesktopSettings } from './desktop-settings';

// Device-local, non-sensitive state of the shell: where the window was, when updates were last checked, and whether to check automatically.
// Anything read back is untrusted (the file can be edited or half-written), so it is sanitised into a state that is always usable.

export interface Display {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopState extends DesktopSettings {
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
  readonly lastCheckedAt?: string;
  readonly autoCheck: boolean;
}

export const DEFAULT_DESKTOP_STATE: DesktopState = { width: 1280, height: 800, maximized: false, autoCheck: true, ...defaultSettings(process.platform) };
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const integer = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) ? value : undefined);
const overlap = (a: Display, b: Display): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high));

export function sanitiseDesktopState(raw: unknown, displays: readonly Display[], platform: NodeJS.Platform = process.platform): DesktopState {
  const input = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  let width = Math.max(integer(input['width']) ?? DEFAULT_DESKTOP_STATE.width, MIN_WIDTH);
  let height = Math.max(integer(input['height']) ?? DEFAULT_DESKTOP_STATE.height, MIN_HEIGHT);
  let x = integer(input['x']);
  let y = integer(input['y']);
  if (x === undefined || y === undefined) {
    x = undefined;
    y = undefined;
  }

  const primary = displays[0];
  if (primary === undefined) {
    x = undefined;
    y = undefined;
  } else {
    // The display the window mostly sits on; if none (its display is gone), the first one.
    const wanted: Display = { x: x ?? primary.x, y: y ?? primary.y, width, height };
    let target = primary;
    let best = 0;
    if (x !== undefined) {
      for (const display of displays) {
        const area = overlap(wanted, display);
        if (area > best) {
          best = area;
          target = display;
        }
      }
    }
    width = Math.min(width, target.width);
    height = Math.min(height, target.height);
    if (x !== undefined && y !== undefined) {
      x = clamp(x, target.x, target.x + target.width - width);
      y = clamp(y, target.y, target.y + target.height - height);
    }
  }

  const lastCheckedAt = input['lastCheckedAt'];
  return {
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    width,
    height,
    maximized: input['maximized'] === true,
    ...(typeof lastCheckedAt === 'string' && ISO_DATE.test(lastCheckedAt) && !Number.isNaN(Date.parse(lastCheckedAt)) ? { lastCheckedAt } : {}),
    autoCheck: typeof input['autoCheck'] === 'boolean' ? input['autoCheck'] : true,
    ...sanitiseSettings(input, platform),
  };
}

export interface DesktopStateStore {
  get(): DesktopState;
  update(change: Partial<DesktopState>): void;
  /** Writes now, e.g. before the app quits. */
  flush(): void;
}

/** Loads the file once, and saves changes after a short pause so that dragging a window does not hammer the disk. */
export function createDesktopStateStore(file: string, displays: () => readonly Display[], delayMs = 500): DesktopStateStore {
  const read = (): unknown => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
  };
  let state = sanitiseDesktopState(read(), displays());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = (): void => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
      renameSync(temporary, file);
    } catch {
      // A state file that cannot be written must never take the app down: the next start just uses the defaults.
    }
  };

  return {
    get: () => state,
    update(change) {
      state = sanitiseDesktopState({ ...state, ...change }, displays());
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        write();
      }, delayMs);
      timer.unref?.();
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      write();
    },
  };
}
