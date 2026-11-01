// Category colours. A colour is only ever a swatch next to a name, never the sole carrier of meaning.

export const COLOR_COUNT = 12;
export const COLORS = ['#0b57d0', '#146c2e', '#b3261e', '#8a5100', '#6f42c1', '#006a6a', '#a8326d', '#5a6b00', '#7a4a2a', '#2b6cb0', '#4a4f57', '#b45309'] as const;

export const colorFor = (index: number): string => COLORS[index % COLOR_COUNT] ?? COLORS[0];
