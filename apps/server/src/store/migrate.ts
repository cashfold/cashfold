import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import pg from 'pg';

// Plain SQL migrations (apps/server/migrations/NNNN_name.sql), applied in order by Kysely's migrator, each in its own
// transaction and under an advisory lock so two replicas starting together cannot race.

export const MIGRATIONS_DIR = process.env['MIGRATIONS_DIR'] ?? new URL('../../migrations/', import.meta.url).pathname;

export function sqlMigrations(dir: string = MIGRATIONS_DIR): MigrationProvider {
  return {
    async getMigrations() {
      const files = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
      const out: Record<string, Migration> = {};
      files.forEach((file, i) => {
        if (Number(file.slice(0, 4)) !== i + 1) throw new Error(`migration numbering must be gapless from 0001; got ${file} at position ${i + 1}`);
        const text = readFileSync(join(dir, file), 'utf8');
        out[file.slice(0, -4)] = { up: async (db) => void (await sql.raw(text).execute(db)) };
      });
      return out;
    },
  };
}

export async function migrate(pool: pg.Pool, dir?: string): Promise<string[]> {
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  // Kysely looks for its bookkeeping tables in every schema unless told which one; name the connection's own.
  const { rows } = await sql<{ schema: string }>`SELECT current_schema() AS schema`.execute(db);
  const { error, results } = await new Migrator({ db, provider: sqlMigrations(dir), migrationTableSchema: rows[0]!.schema }).migrateToLatest();
  if (error !== undefined) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
