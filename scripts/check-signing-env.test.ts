import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { checkSigningEnv } from './check-signing-env.mjs';

// Run first in every signing job (FR-030, P-8): signing is either complete or it stops, and the message says what is missing, never what is set.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-22T12:00:00.000Z');
const APPLE = { APPLE_CERT_P12: 'secret-p12-value', APPLE_CERT_PASSWORD: 'secret-password-value', APPLE_API_KEY: 'secret-api-key-value', APPLE_API_KEY_ID: 'KEYID12345', APPLE_API_ISSUER: 'issuer-uuid-value' };
const PFX = { WIN_CSC_LINK: 'secret-pfx-value', WIN_CSC_KEY_PASSWORD: 'secret-pfx-password' };
const AZURE = {
  AZURE_TENANT_ID: 'tenant-value',
  AZURE_CLIENT_ID: 'client-value',
  AZURE_CLIENT_SECRET: 'secret-azure-value',
  AZURE_TRUSTED_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net',
  AZURE_TRUSTED_SIGNING_ACCOUNT: 'account',
  AZURE_TRUSTED_SIGNING_PROFILE: 'profile',
};
const without = (values: Record<string, string>, name: string): Record<string, string> => Object.fromEntries(Object.entries(values).filter(([key]) => key !== name));
const inDays = (n: number) => (): Date => new Date(NOW.getTime() + n * DAY);
const check = (platform: string, env: Record<string, string | undefined>, expiry: (() => Date | undefined) | undefined = inDays(365)) => checkSigningEnv({ platform, env, now: NOW, certificateExpiry: expiry });

describe('macOS', () => {
  it('needs the certificate, its password and the three notarization values', () => {
    expect(check('darwin', APPLE)).toEqual({ problems: [], warnings: [] });
    for (const name of Object.keys(APPLE)) {
      const result = check('darwin', without(APPLE, name));
      expect(result.problems, name).toEqual([expect.stringContaining(name)]);
    }
  });

  it('treats an empty value as missing', () => {
    expect(check('darwin', { ...APPLE, APPLE_API_KEY_ID: '' }).problems).toEqual([expect.stringContaining('APPLE_API_KEY_ID')]);
    expect(check('darwin', { ...APPLE, APPLE_API_KEY_ID: '   ' }).problems).toEqual([expect.stringContaining('APPLE_API_KEY_ID')]);
  });

  it('names every missing variable at once', () => {
    expect(check('darwin', {}).problems).toHaveLength(Object.keys(APPLE).length);
  });

  it('fails for a certificate that has expired', () => {
    expect(check('darwin', APPLE, inDays(-1)).problems).toEqual([expect.stringMatching(/APPLE_CERT_P12.*expired/)]);
  });

  it('warns about a certificate that expires within 30 days, and not before', () => {
    expect(check('darwin', APPLE, inDays(29)).warnings).toEqual([expect.stringMatching(/APPLE_CERT_P12.*29 days/)]);
    expect(check('darwin', APPLE, inDays(31)).warnings).toEqual([]);
  });

  it('fails when the certificate cannot be read at all (a wrong password or a damaged file)', () => {
    expect(check('darwin', APPLE, () => undefined).problems).toEqual([expect.stringMatching(/APPLE_CERT_P12.*read/)]);
  });
});

describe('Windows', () => {
  it('with no signing route chosen, needs nothing and says the installer will be unsigned', () => {
    const result = check('win32', { CASHFOLD_WIN_SIGNING: 'none' });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([expect.stringMatching(/Windows.*unsigned/i)]);
  });

  it('with a certificate file, needs the file and its password, and checks its expiry', () => {
    expect(check('win32', { CASHFOLD_WIN_SIGNING: 'pfx', ...PFX })).toEqual({ problems: [], warnings: [] });
    expect(check('win32', { CASHFOLD_WIN_SIGNING: 'pfx' }).problems).toHaveLength(2);
    expect(check('win32', { CASHFOLD_WIN_SIGNING: 'pfx', ...PFX }, inDays(-3)).problems).toEqual([expect.stringMatching(/WIN_CSC_LINK.*expired/)]);
    expect(check('win32', { CASHFOLD_WIN_SIGNING: 'pfx', ...PFX }, inDays(10)).warnings).toEqual([expect.stringMatching(/WIN_CSC_LINK.*10 days/)]);
  });

  it('with Azure Trusted Signing, needs the identity and the account details', () => {
    expect(check('win32', { CASHFOLD_WIN_SIGNING: 'azure', ...AZURE })).toEqual({ problems: [], warnings: [] });
    for (const name of Object.keys(AZURE)) {
      expect(check('win32', { CASHFOLD_WIN_SIGNING: 'azure', ...without(AZURE, name) }).problems, name).toEqual([expect.stringContaining(name)]);
    }
  });

  it('refuses a route it does not know, or none chosen at all (a choice must be made)', () => {
    expect(check('win32', { CASHFOLD_WIN_SIGNING: 'carrier-pigeon' }).problems).toEqual([expect.stringContaining('CASHFOLD_WIN_SIGNING')]);
    expect(check('win32', {}).problems).toEqual([expect.stringContaining('CASHFOLD_WIN_SIGNING')]);
  });
});

describe('Linux', () => {
  it('needs no operating-system signing', () => {
    expect(check('linux', {})).toEqual({ problems: [], warnings: [] });
  });
});

describe('what is said', () => {
  it('names the variables and never repeats a value', () => {
    const all = JSON.stringify([check('darwin', { ...APPLE, APPLE_API_KEY_ID: '' }, inDays(5)), check('win32', { CASHFOLD_WIN_SIGNING: 'pfx', ...PFX, WIN_CSC_KEY_PASSWORD: '' }, inDays(5)), check('win32', { CASHFOLD_WIN_SIGNING: 'azure', ...AZURE, AZURE_CLIENT_ID: '' })]);
    for (const value of ['secret-p12-value', 'secret-password-value', 'secret-api-key-value', 'issuer-uuid-value', 'secret-pfx-value', 'secret-pfx-password', 'secret-azure-value', 'tenant-value']) expect(all).not.toContain(value);
  });
});
