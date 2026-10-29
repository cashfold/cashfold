import { describe, expect, it } from 'vitest';
import { createSignOutGuard } from './sign-out-guard';

describe('the guard that keeps leaving the service from erasing twice (spec 011)', () => {
  it('ignores DeviceRemoved while a sign-out is running, and nothing else', () => {
    const guard = createSignOutGuard();
    expect(guard.ignores('DeviceRemoved')).toBe(false);
    guard.begin();
    expect(guard.ignores('DeviceRemoved')).toBe(true);
    expect(guard.ignores('RemoteChanged')).toBe(false);
    expect(guard.ignores('SyncChanged')).toBe(false);
  });

  it('stops ignoring once the sign-out has ended', () => {
    const guard = createSignOutGuard();
    guard.begin();
    guard.end();
    expect(guard.ignores('DeviceRemoved')).toBe(false);
  });

  it('is on until every sign-out that began has ended', () => {
    const guard = createSignOutGuard();
    guard.begin();
    guard.begin();
    guard.end();
    expect(guard.ignores('DeviceRemoved')).toBe(true);
    guard.end();
    expect(guard.ignores('DeviceRemoved')).toBe(false);
  });
});
