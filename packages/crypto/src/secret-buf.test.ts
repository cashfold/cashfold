import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SecretBuf } from './secret-buf.js';

describe('SecretBuf', () => {
  it('exposes bytes only through use()', () => {
    const s = SecretBuf.from(Uint8Array.of(1, 2, 3));
    expect(s.length).toBe(3);
    expect(s.use((b) => Array.from(b))).toEqual([1, 2, 3]);
  });

  it('from() copies and take() adopts', () => {
    const src = Uint8Array.of(9, 9);
    const copy = SecretBuf.from(src);
    src.fill(0);
    expect(copy.use((b) => b[0])).toBe(9);
    const adopted = SecretBuf.take(src);
    expect(adopted.use((b) => b)).toBe(src);
  });

  it('wipe() zeroes the underlying array and blocks further use', () => {
    const raw = Uint8Array.of(7, 7, 7);
    const s = SecretBuf.take(raw);
    s.wipe();
    expect(Array.from(raw)).toEqual([0, 0, 0]);
    expect(s.isWiped).toBe(true);
    expect(s.length).toBe(0);
    expect(() => s.use(() => 0)).toThrow('wiped');
    s.wipe(); // idempotent
  });

  it('has no serialisation and redacts inspection', () => {
    const s = SecretBuf.from(Uint8Array.of(0xde, 0xad));
    expect(JSON.stringify(s)).toBe('{}');
    expect(JSON.stringify({ s })).toBe('{"s":{}}');
    expect(inspect(s)).toBe('SecretBuf { 2 bytes }');
    expect(String(s)).not.toContain('dead');
    s.wipe();
    expect(inspect(s)).toBe('SecretBuf { wiped }');
  });
});
