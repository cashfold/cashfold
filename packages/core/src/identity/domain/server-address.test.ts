import { describe, expect, it } from 'vitest';
import { normaliseServerAddress } from './server-address';

describe('normaliseServerAddress (FR-099: the service address is user-chosen)', () => {
  it('accepts https addresses, trims, lower-cases the host and drops a trailing slash', () => {
    expect(normaliseServerAddress('  https://Relay.Example.com/  ')).toEqual({ ok: true, value: 'https://relay.example.com' });
    expect(normaliseServerAddress('https://relay.example.com:8443/api')).toEqual({ ok: true, value: 'https://relay.example.com:8443/api' });
  });

  it('accepts plain http only for the local machine (development and self-hosting on localhost)', () => {
    for (const ok of ['http://localhost:8080', 'http://127.0.0.1:3000', 'http://[::1]:8080']) expect(normaliseServerAddress(ok).ok, ok).toBe(true);
    for (const bad of ['http://relay.example.com', 'http://192.168.1.5:8080']) expect(normaliseServerAddress(bad), bad).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_server' }) });
  });

  it.each(['', 'relay.example.com', 'ftp://relay.example.com', 'https://', 'https:// space.example.com', 'https://user:pass@relay.example.com', 'https://relay.example.com?x=1', 'https://relay.example.com#frag', 'javascript:alert(1)', 'https://relay..example.com', 'https://-bad.example.com'])('rejects %j', (bad) => {
    expect(normaliseServerAddress(bad)).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_server' }) });
  });

  it('does not accept credentials in the address', () => {
    expect(normaliseServerAddress('https://me:secret@relay.example.com').ok).toBe(false);
  });
});
