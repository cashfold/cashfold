export const hex = (s: string): Uint8Array => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
