import type { EncryptedDatabase } from './database';
import { MIGRATIONS, type Migration } from './migrations/generated';

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Applies pending migrations in order, each in its own transaction, tracking progress in `PRAGMA user_version`.
 * A database newer than this build is refused rather than half-understood.
 */
export async function migrate(db: EncryptedDatabase, migrations: readonly Migration[] = MIGRATIONS): Promise<number> {
  const latest = migrations.at(-1)?.version ?? 0;
  const current = db.userVersion;
  if (current > latest) throw new MigrationError(`database schema ${current} is newer than this app understands (${latest})`);
  for (const m of migrations) {
    if (m.version <= current) continue;
    await db.transaction(() => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return latest;
}
