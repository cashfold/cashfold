import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { containsAmount, containsBytes, encodings } from '../../../e2e/fixtures/leak-scan.js';
import { createAccount } from '../../../e2e/fixtures/nav.js';
import { addExpense, expect, signUp, test } from './fixtures';

// Constitution Quality Gates (plaintext-leak scan), FR-006: after a session with recognisable names, notes and amounts, no file the shell
// or the browser engine keeps in the user-data folder contains them, and the database files are encrypted.

const SEEDS = ['Zebra Quartz Savings', 'Marmalade Kiosk Purchase', 'Hypnotic Walrus Payee'];
const AMOUNT_TYPED = '7777.77';
const AMOUNT_MINOR = '777777';

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue; // a socket or a file that vanished while the engine was shutting down
    }
    if (stat.isDirectory()) yield* files(path);
    else if (stat.isFile()) yield path;
  }
}

test('nothing the user typed is readable anywhere in the user-data folder, and the database is encrypted', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await createAccount(page, SEEDS[0]!, '500.00');
  await addExpense(page, SEEDS[0]!, AMOUNT_TYPED, `${SEEDS[1]} ${SEEDS[2]}`);
  await session.quit(app);

  const needles = SEEDS.flatMap((seed) => encodings(seed).map((bytes) => ({ seed, bytes })));
  const leaks: string[] = [];
  let scanned = 0;
  let databases = 0;
  for (const file of files(session.userDataDir)) {
    const rel = relative(session.userDataDir, file);
    const bytes = new Uint8Array(readFileSync(file));
    scanned++;
    for (const { seed, bytes: needle } of needles) if (containsBytes(bytes, needle)) leaks.push(`${rel} contains "${seed}"`);
    const text = Buffer.from(bytes).toString('latin1');
    for (const amount of [AMOUNT_TYPED, AMOUNT_MINOR]) if (containsAmount(text, amount)) leaks.push(`${rel} contains the amount ${amount}`);
    // The database lives in the engine's file-system storage; a plain SQLite file would start with this header.
    if (/File System/i.test(rel)) {
      databases++;
      if (Buffer.from(bytes.subarray(0, 15)).toString('latin1') === 'SQLite format 3') leaks.push(`${rel} is an unencrypted SQLite database`);
    }
  }
  expect(scanned, 'the scan looked at real files').toBeGreaterThan(20);
  expect(databases, 'the encrypted database files were found and checked').toBeGreaterThan(0);
  expect(leaks).toEqual([]);
});
