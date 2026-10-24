import { describe, expect, it } from 'vitest';
import { DEFAULT_TRUST_PROXY, loadConfig } from './config.js';

const base = { SERVER_SECRET: 'ab'.repeat(32) };

describe('loadConfig', () => {
  it('uses a scale of 1 and trusts only proxies on the same machine or private network by default', () => {
    const c = loadConfig(base);
    expect(c.rateLimitScale).toBe(1);
    expect(c.trustProxy).toBe(DEFAULT_TRUST_PROXY);
  });

  it('accepts a scale above or below 1', () => {
    expect(loadConfig({ ...base, RATE_LIMIT_SCALE: '100' }).rateLimitScale).toBe(100);
    expect(loadConfig({ ...base, RATE_LIMIT_SCALE: '0.5' }).rateLimitScale).toBe(0.5);
  });

  it.each(['abc', '0', '-1', 'Infinity', 'NaN', '1x'])('refuses RATE_LIMIT_SCALE=%s instead of switching rate limiting off', (value) => {
    expect(() => loadConfig({ ...base, RATE_LIMIT_SCALE: value })).toThrow(/RATE_LIMIT_SCALE/);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['2', 2],
    ['10.0.0.0/8,127.0.0.1', '10.0.0.0/8,127.0.0.1'],
  ])('reads TRUST_PROXY=%s', (value, expected) => {
    expect(loadConfig({ ...base, TRUST_PROXY: value }).trustProxy).toBe(expected);
  });
});
