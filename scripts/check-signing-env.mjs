// Run first in every job that signs (specs/003 FR-030, P-8):  node scripts/check-signing-env.mjs [--platform darwin|win32|linux]
//
// Signing is complete or it stops. The credentials a platform needs must all be present and non-empty, and a certificate that has expired (or
// cannot be read) is a failure. Messages name the variables, never their values; the certificate password is passed to openssl through the
// environment, not a command line. The result is exit code 0 (maybe with warnings) or 1 (problems listed).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WARN_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const APPLE = ['APPLE_CERT_P12', 'APPLE_CERT_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
const WINDOWS_PFX = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
const WINDOWS_AZURE = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT', 'AZURE_TRUSTED_SIGNING_ACCOUNT', 'AZURE_TRUSTED_SIGNING_PROFILE'];

const present = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

/**
 * @param {{ platform: string, env: Record<string, string | undefined>, now: Date, certificateExpiry: (which: 'apple' | 'windows') => Date | undefined }} input
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function checkSigningEnv({ platform, env, now, certificateExpiry }) {
  const problems = [];
  const warnings = [];

  const requireAll = (names) => {
    for (const name of names) if (!present(env, name)) problems.push(`${name} is not set`);
    return names.every((name) => present(env, name));
  };
  const checkExpiry = (variable, which) => {
    const expires = certificateExpiry(which);
    if (expires === undefined) return problems.push(`${variable}: the certificate could not be read (wrong password, or not a certificate)`);
    const days = Math.floor((expires.getTime() - now.getTime()) / DAY);
    if (expires.getTime() <= now.getTime()) problems.push(`${variable}: the certificate has expired`);
    else if (days <= WARN_DAYS) warnings.push(`${variable}: the certificate expires in ${days} days; renew it before then`);
  };

  if (platform === 'darwin') {
    if (requireAll(APPLE)) checkExpiry('APPLE_CERT_P12', 'apple');
  } else if (platform === 'win32') {
    const route = env.CASHFOLD_WIN_SIGNING;
    if (route === 'none') warnings.push('Windows: no signing route is configured, so the Windows installer will be unsigned');
    else if (route === 'pfx') {
      if (requireAll(WINDOWS_PFX)) checkExpiry('WIN_CSC_LINK', 'windows');
    } else if (route === 'azure') requireAll(WINDOWS_AZURE);
    else problems.push(`CASHFOLD_WIN_SIGNING must be one of azure, pfx or none (it is ${route === undefined || route === '' ? 'not set' : 'something else'}): choose how Windows is signed`);
  }
  return { problems, warnings };
}

/** The end date of the certificate in a base64 PKCS#12 file, read with openssl; the password goes through the environment. */
export function readP12Expiry(p12Base64, password) {
  const dir = mkdtempSync(join(tmpdir(), 'cert-'));
  try {
    const file = join(dir, 'cert.p12');
    writeFileSync(file, Buffer.from(p12Base64, 'base64'));
    const extract = spawnSync('openssl', ['pkcs12', '-in', file, '-nokeys', '-clcerts', '-passin', 'env:CERT_PASSWORD', '-legacy'], { encoding: 'utf8', env: { ...process.env, CERT_PASSWORD: password } });
    const pem = extract.status === 0 ? extract.stdout : spawnSync('openssl', ['pkcs12', '-in', file, '-nokeys', '-clcerts', '-passin', 'env:CERT_PASSWORD'], { encoding: 'utf8', env: { ...process.env, CERT_PASSWORD: password } }).stdout;
    const end = spawnSync('openssl', ['x509', '-noout', '-enddate'], { input: pem, encoding: 'utf8' });
    const match = /notAfter=(.+)/.exec(end.stdout ?? '');
    const date = match === null ? undefined : new Date(match[1].trim());
    return date === undefined || Number.isNaN(date.getTime()) ? undefined : date;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const platform = process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : process.platform;
  const { problems, warnings } = checkSigningEnv({
    platform,
    env: process.env,
    now: new Date(),
    certificateExpiry: (which) =>
      which === 'apple' ? readP12Expiry(process.env.APPLE_CERT_P12 ?? '', process.env.APPLE_CERT_PASSWORD ?? '') : readP12Expiry(process.env.WIN_CSC_LINK ?? '', process.env.WIN_CSC_KEY_PASSWORD ?? ''),
  });
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (problems.length > 0) {
    console.error('Signing cannot go ahead:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`signing credentials for ${platform}: complete`);
}
