import { describe, expect, it } from 'vitest';
import { missingAddress, serverToSend, startsLocalOnly } from './sign-up-choice';

// The web package has no DOM test environment, so the form's two decisions live here as plain functions; the clicking is covered by e2e/us10-local-only.spec.ts.
describe('where sign-up starts (FR-012, FR-013)', () => {
  it('keeps everything on this device when the build has no default service', () => {
    expect(startsLocalOnly('')).toBe(true);
    expect(startsLocalOnly('   ')).toBe(true);
  });

  it('starts as it always did, with the address pre-filled, when the build has one', () => {
    expect(startsLocalOnly('https://relay.example.com')).toBe(false);
  });
});

describe('what sign-up sends (FR-001, FR-005)', () => {
  it('sends no address at all when the person keeps everything on this device, whatever was typed before', () => {
    expect(serverToSend(true, 'https://relay.example.com')).toBe('');
    expect(serverToSend(true, '')).toBe('');
  });

  it('sends the address as typed otherwise', () => {
    expect(serverToSend(false, 'https://relay.example.com')).toBe('https://relay.example.com');
  });
});

describe('an empty address is never a quiet local-only account (FR-002)', () => {
  it('is a missing address when the person has not chosen to keep everything on this device', () => {
    expect(missingAddress(false, '')).toBe(true);
    expect(missingAddress(false, '   ')).toBe(true);
  });

  it('is not missing when an address was typed, or when the person chose to keep everything on this device', () => {
    expect(missingAddress(false, 'https://relay.example.com')).toBe(false);
    expect(missingAddress(true, '')).toBe(false);
  });
});
