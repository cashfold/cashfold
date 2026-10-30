// The curated primary colours (spec 014). Each is a hand-set pair of values per theme so every contrast pair is known to pass (palette.test.ts)
// and every icon can be drawn ahead of time (scripts/gen-brand-assets.mjs reads `light.primary`). `emerald` equals the original tokens.
// app/tokens.css carries these values as [data-primary] overrides; tokens-primary.test.ts fails if the two drift apart.
export interface PrimaryColors {
  readonly primary: string;
  readonly onPrimary: string;
  readonly accentText: string;
  readonly focus: string;
}

export interface PaletteColor {
  readonly id: string;
  readonly light: PrimaryColors;
  readonly dark: PrimaryColors;
}

const light = (primary: string, focus: string): PrimaryColors => ({ primary, onPrimary: '#ffffff', accentText: primary, focus });
const dark = (primary: string, accentText: string): PrimaryColors => ({ primary, onPrimary: '#09090b', accentText, focus: accentText });

export const PALETTE = [
  { id: 'emerald', light: light('#047857', '#059669'), dark: dark('#10b981', '#34d399') },
  { id: 'teal', light: light('#0f766e', '#0d9488'), dark: dark('#14b8a6', '#2dd4bf') },
  { id: 'cyan', light: light('#0e7490', '#0891b2'), dark: dark('#06b6d4', '#22d3ee') },
  { id: 'blue', light: light('#1d4ed8', '#2563eb'), dark: dark('#60a5fa', '#93c5fd') },
  { id: 'indigo', light: light('#4338ca', '#4f46e5'), dark: dark('#818cf8', '#a5b4fc') },
  { id: 'violet', light: light('#6d28d9', '#7c3aed'), dark: dark('#a78bfa', '#c4b5fd') },
  { id: 'pink', light: light('#be185d', '#db2777'), dark: dark('#f472b6', '#f9a8d4') },
  { id: 'orange', light: light('#c2410c', '#ea580c'), dark: dark('#fb923c', '#fdba74') },
  { id: 'amber', light: light('#b45309', '#d97706'), dark: dark('#fbbf24', '#fcd34d') },
  { id: 'slate', light: light('#475569', '#64748b'), dark: dark('#94a3b8', '#cbd5e1') },
] as const satisfies readonly PaletteColor[];

export type PrimaryChoice = (typeof PALETTE)[number]['id'];
export const PRIMARY_IDS: readonly PrimaryChoice[] = PALETTE.map((c) => c.id);
export const DEFAULT_PRIMARY: PrimaryChoice = 'emerald';

/** A stored value as a palette id; anything unknown is the default. */
export function parsePrimary(x: unknown): PrimaryChoice {
  return PRIMARY_IDS.find((id) => id === x) ?? DEFAULT_PRIMARY;
}

export const colorOf = (id: PrimaryChoice): PaletteColor => PALETTE.find((c) => c.id === id) ?? PALETTE[0];
