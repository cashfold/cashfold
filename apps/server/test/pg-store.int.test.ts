import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { createPgStore } from '../src/store/pg-store.js';
import { describeStoreContract } from '../src/store/store.contract.js';

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
});
afterAll(async () => {
  await container?.stop();
});

/** A fresh schema per test keeps the cases independent without a container each. */
let counter = 0;
describeStoreContract('postgresql', async () => {
  const schema = `t${Date.now().toString(36)}_${counter++}`;
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const url = new URL(container.getConnectionUri());
  url.searchParams.set('options', `-c search_path=${schema}`);
  return createPgStore(url.toString());
});
