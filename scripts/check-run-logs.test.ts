import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { findSecretsInLog } from './check-run-logs.mjs';

// After a signed run, the log of every job is searched for the secrets that were in use (FR-029, SC-010). GitHub masks them; this shows it.

describe('looking for secrets in a log', () => {
  const log = ['build started', 'signing with ***', 'upload done'].join('\n');

  it('finds nothing in a log where every secret is masked', () => {
    expect(findSecretsInLog(log, { APPLE_CERT_PASSWORD: 'hunter2-hunter2', WIN_CSC_KEY_PASSWORD: 'correct-horse' })).toEqual([]);
  });

  it('names the variable whose value appears, never the value', () => {
    const leaked = `${log}\nthe password is hunter2-hunter2 today`;
    const found = findSecretsInLog(leaked, { APPLE_CERT_PASSWORD: 'hunter2-hunter2', WIN_CSC_KEY_PASSWORD: 'correct-horse' });
    expect(found).toEqual(['APPLE_CERT_PASSWORD']);
    expect(JSON.stringify(found)).not.toContain('hunter2');
  });

  it('also finds a value that was base64-encoded or URL-encoded on the way', () => {
    const value = 'p@ss word/+=';
    expect(findSecretsInLog(`x ${Buffer.from(value).toString('base64')} y`, { A: value })).toEqual(['A']);
    expect(findSecretsInLog(`x ${encodeURIComponent(value)} y`, { A: value })).toEqual(['A']);
  });

  it('ignores values too short to mean anything, and empty ones', () => {
    expect(findSecretsInLog('a b c 1 2 3', { SHORT: 'a', EMPTY: '', SPACE: '  ' })).toEqual([]);
  });

  it('looks at each line of a multi-line secret, such as a key file', () => {
    const key = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIKEYMATERIALHERE1234567890\n-----END PRIVATE KEY-----';
    expect(findSecretsInLog('noise\nMC4CAQAwBQYDK2VwBCIEIKEYMATERIALHERE1234567890\nmore', { APPLE_API_KEY: key })).toEqual(['APPLE_API_KEY']);
  });
});
