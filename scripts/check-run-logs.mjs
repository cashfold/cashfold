// After a signed release run, searches the log of every job for the secrets that were in use:  node scripts/check-run-logs.mjs <run id>
// (FR-029, SC-010). GitHub masks a secret it knows by name; this shows that none got into a log in another shape. The values are read from
// the environment variables named in SECRETS_TO_CHECK (space separated), so run it where those are set (the maintainer's shell, from a
// password manager); it needs the GitHub CLI. It prints the NAMES of any variable whose value turned up, never a value.
import { spawnSync } from 'node:child_process';

const MIN_LENGTH = 6;

function variants(value) {
  const forms = new Set([value, Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url'), encodeURIComponent(value)]);
  // A multi-line secret (a key file) is searched line by line: one line of it is already a leak.
  for (const line of value.split(/\r?\n/)) if (line.trim().length >= 12 && !line.startsWith('-----')) forms.add(line.trim());
  return [...forms].filter((form) => form.trim().length >= MIN_LENGTH);
}

/** @returns {string[]} the names of the secrets whose value appears in the log */
export function findSecretsInLog(log, secrets) {
  return Object.entries(secrets)
    .filter(([, value]) => typeof value === 'string' && value.trim().length >= MIN_LENGTH)
    .filter(([, value]) => variants(value).some((form) => log.includes(form)))
    .map(([name]) => name);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = process.argv[2];
  if (run === undefined) {
    console.error('usage: check-run-logs.mjs <run id>   (SECRETS_TO_CHECK names the environment variables that hold the secrets)');
    process.exit(2);
  }
  const names = (process.env.SECRETS_TO_CHECK ?? '').split(/\s+/).filter(Boolean);
  if (names.length === 0) {
    console.error('SECRETS_TO_CHECK is empty: name the environment variables that hold the secrets to look for');
    process.exit(2);
  }
  const fetched = spawnSync('gh', ['run', 'view', run, '--log'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (fetched.status !== 0) {
    console.error('could not read the run log with the GitHub CLI');
    process.exit(2);
  }
  const found = findSecretsInLog(fetched.stdout, Object.fromEntries(names.map((name) => [name, process.env[name]])));
  if (found.length > 0) {
    console.error(`These secrets appear in the log of run ${run}: ${found.join(', ')}. Rotate them.`);
    process.exit(1);
  }
  console.log(`run ${run}: none of ${names.length} secrets appears in its log`);
}
