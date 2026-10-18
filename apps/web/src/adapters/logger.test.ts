import { lit } from '@cashfold/core';
import { describe, expect, it, vi } from 'vitest';
import { createAppLogger, createConsoleSink, createRingSink } from './logger';

describe('ring sink', () => {
  it('keeps the most recent entries only', () => {
    const ring = createRingSink(3);
    const log = createAppLogger([ring.sink]);
    for (let i = 0; i < 5; i++) log.info('tick.n', { i });
    expect(ring.entries().map((e) => e.fields['i'])).toEqual([2, 3, 4]);
  });

  it('exposes sanitised entries only', () => {
    const ring = createRingSink(5);
    createAppLogger([ring.sink]).warn('x.y', { amount_minor: 5, secret: 'hunter2', amount: 12345678901234567890n, tag: lit('ok') } as never);
    expect(JSON.stringify(ring.entries(), (_k, v) => (typeof v === 'bigint' ? 'BIG' : v))).not.toMatch(/hunter2|12345678901234567890/);
    expect(ring.entries()[0]!.fields['tag']).toBe('ok');
  });
});

describe('console sink', () => {
  it('prints only warnings and errors, as event plus sanitised fields', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const log = createAppLogger([createConsoleSink()]);
    log.info('a.b', { n: 1 });
    log.warn('a.b', { n: 2 });
    log.error('a.c', { password: 'leak' } as never);
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('leak');
    warn.mockRestore(); error.mockRestore(); info.mockRestore();
  });
});
