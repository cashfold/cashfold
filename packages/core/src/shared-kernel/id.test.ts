import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { idFromBytes, idToBytes, newIdV4, newIdV7, parseId, timestampOfV7, uuidV5 } from './id.js';

const DNS_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error('unexpected error');
  return r.value;
};
const bytes = (fill: (i: number) => number) => Uint8Array.from({ length: 16 }, (_, i) => fill(i));
const rng = (seed: number) => (n: number) => Uint8Array.from({ length: n }, (_, i) => (seed * 31 + i * 7) & 0xff);

describe('Id', () => {
  it('parses and normalises canonical UUID text', () => {
    expect(parseId('6BA7B810-9DAD-11D1-80B4-00C04FD430C8')).toEqual({ ok: true, value: DNS_NS });
    expect(parseId('nope').ok).toBe(false);
    expect(parseId('6ba7b8109dad11d180b400c04fd430c8').ok).toBe(false);
  });

  it('round-trips bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 16 }), (b) => {
        expect(idToBytes(idFromBytes(b))).toEqual(b);
      }),
    );
  });

  it('UUIDv4 sets version and variant bits', () => {
    const id = newIdV4(rng(1));
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
  });

  it('UUIDv5 matches the RFC 4122 known answer', () => {
    expect(uuidV5(unwrap(parseId(DNS_NS)), 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    expect(uuidV5(unwrap(parseId(DNS_NS)), 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('UUIDv5 is deterministic and name-sensitive', () => {
    const ns = unwrap(parseId(DNS_NS));
    expect(uuidV5(ns, 'a')).toBe(uuidV5(ns, 'a'));
    expect(uuidV5(ns, 'a')).not.toBe(uuidV5(ns, 'b'));
    expect(uuidV5(ns, 'ü')[14]).toBe('5');
  });

  it('UUIDv7 embeds the millisecond timestamp and sorts by time', () => {
    const a = newIdV7(1_700_000_000_000, rng(2));
    const b = newIdV7(1_700_000_000_001, rng(3));
    expect(a[14]).toBe('7');
    expect('89ab').toContain(a[19]);
    expect(timestampOfV7(a)).toBe(1_700_000_000_000);
    expect(a < b).toBe(true);
    expect(idToBytes(newIdV7(0xffff_ffff_ffff, rng(4))).slice(0, 6)).toEqual(Uint8Array.from([255, 255, 255, 255, 255, 255]));
  });

  it('requires 16 bytes', () => {
    expect(() => idFromBytes(bytes(() => 0).slice(0, 15))).toThrow();
  });
});
