import type { HelpKeys, HelpModifier } from '@cashfold/platform';
import type { DesktopPlatform } from './desktop-store';

// Writes a shortcut the way the person's system writes it (spec 008): symbols on macOS, words elsewhere. The spoken form spells every key out, so a
// screen reader does not depend on how it pronounces ⌘ or ⇧.

export interface WrittenShortcut {
  readonly text: string;
  readonly spoken: string;
}

const MAC_SYMBOL: Record<'ctrl' | 'alt' | 'shift' | 'command', string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', command: '⌘' };
const MAC_ORDER = ['ctrl', 'alt', 'shift', 'command'] as const;
const OTHER_ORDER = ['ctrl', 'alt', 'shift'] as const;
const SPOKEN_KEY: Record<string, string> = { ',': 'comma', '+': 'plus', '-': 'minus' };

type Resolved = (typeof MAC_ORDER)[number];

const resolve = (modifier: HelpModifier, mac: boolean): Resolved => (modifier === 'primary' ? (mac ? 'command' : 'ctrl') : modifier);

export function formatShortcut(keys: HelpKeys, platform: DesktopPlatform): WrittenShortcut {
  const mac = platform === 'darwin';
  const held = new Set(keys.modifiers.map((m) => resolve(m, mac)));
  const spokenKey = SPOKEN_KEY[keys.key] ?? keys.key;
  if (mac) {
    const symbols = MAC_ORDER.filter((m) => held.has(m));
    const spokenNames: Record<Resolved, string> = { ctrl: 'Control', alt: 'Option', shift: 'Shift', command: 'Command' };
    return { text: symbols.map((m) => MAC_SYMBOL[m]).join('') + keys.key, spoken: [...symbols.map((m) => spokenNames[m]), spokenKey].join(', ') };
  }
  const words = OTHER_ORDER.filter((m) => held.has(m));
  const names: Record<(typeof OTHER_ORDER)[number], string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const spokenNames: Record<(typeof OTHER_ORDER)[number], string> = { ctrl: 'Control', alt: 'Alt', shift: 'Shift' };
  return { text: [...words.map((m) => names[m]), keys.key].join('+'), spoken: [...words.map((m) => spokenNames[m]), spokenKey].join(', ') };
}
