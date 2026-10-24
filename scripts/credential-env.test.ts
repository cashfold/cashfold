import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { withoutEmptyCredentials } from './lib/credential-env.mjs';

describe('withoutEmptyCredentials', () => {
  it('removes signing variables that are set but empty, which electron-builder would read as a path', () => {
    const env = { CSC_LINK: '', CSC_KEY_PASSWORD: '', WIN_CSC_LINK: '  ', APPLE_API_KEY_ID: '', AZURE_TENANT_ID: '', PATH: '/usr/bin', HOME: '/home/a' };
    expect(withoutEmptyCredentials(env)).toEqual({ PATH: '/usr/bin', HOME: '/home/a' });
  });

  it('keeps signing variables that have a value, and empty variables that are not credentials', () => {
    const env = { CSC_LINK: 'base64==', CSC_KEY_PASSWORD: 'pw', APPLE_API_KEY_ID: 'ABC', CASHFOLD_SIGN: '', CASHFOLD_WIN_SIGNING: '', EMPTY: '' };
    expect(withoutEmptyCredentials(env)).toEqual(env);
  });
});
