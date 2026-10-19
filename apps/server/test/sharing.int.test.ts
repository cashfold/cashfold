import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { createPgStore } from '../src/store/pg-store.js';
import { describeSharing } from './support/sharing-suite.js';

// The same sharing scenarios as the unit suite, against a real PostgreSQL.
let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
});
afterAll(async () => {
  await container?.stop();
});

let counter = 0;
describeSharing('postgresql', async () => {
  const schema = `s${Date.now().toString(36)}_${counter++}`;
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const url = new URL(container.getConnectionUri());
  url.searchParams.set('options', `-c search_path=${schema}`);
  return createPgStore(url.toString());
});
