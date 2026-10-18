import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Table typings are added with the relay schema (data-model §S).
export type Database = Record<string, never>;

export function createDb(databaseUrl: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
  });
}
