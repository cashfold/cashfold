import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createRelay, type Relay } from './app.js';
import { createMemoryStore } from './store/memory-store.js';

// The OpenAPI contract is normative. Every operation it lists is served, and the relay serves nothing it does not list.

const spec = parse(readFileSync(resolve(import.meta.dirname, '../../../specs/001-secure-finance-core/contracts/sync-api.openapi.yaml'), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
const METHODS = ['get', 'post', 'put', 'delete'];
const documented = new Set(Object.entries(spec.paths).flatMap(([path, ops]) => Object.keys(ops).filter((m) => METHODS.includes(m)).map((m) => `${m.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`)));

// Contract paths the contract lists for later stories; the relay does not serve them yet.
const LATER = new Set(['PUT /folds/:foldId/attachments/:attId/chunks/:index', 'GET /folds/:foldId/attachments/:attId/chunks/:index']);

let relay: Relay;
beforeAll(async () => {
  relay = await createRelay({
    config: { port: 0, store: 'memory', databaseUrl: '', serverSecret: randomBytes(32), registration: 'open', inviteCodes: [], mail: { kind: 'none' }, publicUrl: 'https://x.test', rates: { kind: 'disabled' }, defaultKdf: { mKib: 65_536, t: 3, p: 1 }, allowedOrigins: [] },
    store: createMemoryStore(),
  });
});
afterAll(async () => relay.close());

const sample = (path: string): string => path.replace(/:(\w+)/g, (_, name: string) => (name === 'foldId' || name === 'devId' ? 'AAAAAAAAAAAAAAAAAAAAAA' : name === 'index' ? '0' : 'x1'));

describe('the relay serves the contract', () => {
  it('serves every operation of the contract that is built (an unknown route is a 404 before any check; a real one is refused for lack of a session or a body)', async () => {
    const missing: string[] = [];
    for (const op of documented) {
      if (LATER.has(op) || op.endsWith('/stream')) continue;
      const [method, path] = op.split(' ') as [string, string];
      const res = await relay.app.inject({ method: method as 'GET', url: sample(path), headers: { 'content-type': 'application/cbor' }, ...(method === 'GET' || method === 'DELETE' ? {} : { payload: Buffer.from([0xa0]) }) });
      if (res.statusCode === 404 && !path.startsWith('/rates')) missing.push(op);
    }
    expect(missing).toEqual([]);
  });

  it('answers a route it does not have with 404', async () => {
    expect((await relay.app.inject({ method: 'GET', url: '/nothing/here' })).statusCode).toBe(404);
  });
});
