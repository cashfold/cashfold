import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { z } from 'zod';
import { KdfParamsSchema, KeySetSchema, LOG_ENTRY_TYPES, LogEntrySchema, PUSH_ERROR_CODES } from './index';

// The contracts are normative; the zod schemas must not drift from them. These tests read the contract
// files and compare the facts that both sides state: KDF floors, enumerations, id sizes, ranges.

const contracts = resolve(import.meta.dirname, '../../../../specs/001-secure-finance-core/contracts');
const openapi = parse(readFileSync(resolve(contracts, 'sync-api.openapi.yaml'), 'utf8')) as OpenApi;
const cddl = readFileSync(resolve(contracts, 'op-envelope.cddl'), 'utf8');

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- parsed YAML is untyped

interface OpenApi {
  paths: Record<string, unknown>;
  components: { schemas: Record<string, Json>; responses: Record<string, unknown> };
}

const b = (n: number, fill = 1) => new Uint8Array(n).fill(fill);
const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

function collectRefs(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.add(v);
      else collectRefs(v, out);
    }
  }
}

describe('OpenAPI document is internally consistent', () => {
  it('resolves every $ref', () => {
    const refs = new Set<string>();
    collectRefs(openapi, refs);
    expect(refs.size).toBeGreaterThan(10);
    for (const ref of refs) {
      const path = ref.replace(/^#\//, '').split('/');
      let node: Json = openapi;
      for (const seg of path) node = node?.[seg];
      expect(node, `unresolved ${ref}`).toBeDefined();
    }
  });
});

describe('KdfParams: OpenAPI floors equal the zod schema floors', () => {
  const kdf = openapi.components.schemas.KdfParams.properties;
  const base = { kdf: 'argon2id', m_kib: 32768n, t: 2n, p: 1n, v: 19n, enc_salt: b(16) };

  it('Argon2id: m_kib, t, p minimums', () => {
    const argon = (patch: Record<string, unknown>) => KdfParamsSchema.safeParse(new Map(Object.entries({ ...base, ...patch })));
    expect(argon({ m_kib: BigInt(kdf.m_kib.minimum) }).success).toBe(true);
    expect(argon({ m_kib: BigInt(kdf.m_kib.minimum) - 1n }).success).toBe(false);
    expect(argon({ t: BigInt(kdf.t.minimum) }).success).toBe(true);
    expect(argon({ t: BigInt(kdf.t.minimum) - 1n }).success).toBe(false);
    expect(argon({ p: BigInt(kdf.p.minimum) }).success).toBe(true);
    expect(argon({ p: BigInt(kdf.p.minimum) - 1n }).success).toBe(false);
  });

  it('PBKDF2: iteration minimum', () => {
    const pbkdf2 = (iter: bigint) => KdfParamsSchema.safeParse(new Map<string, unknown>([['kdf', 'pbkdf2-hmac-sha256'], ['iter', iter], ['enc_salt', b(16)]]));
    expect(pbkdf2(BigInt(kdf.iter.minimum)).success).toBe(true);
    expect(pbkdf2(BigInt(kdf.iter.minimum) - 1n).success).toBe(false);
  });

  it('kdf names and salt size agree', () => {
    expect(kdf.kdf.enum).toEqual(['argon2id', 'pbkdf2-hmac-sha256']);
    expect(openapi.components.schemas.Bytes16.description).toBe('16 bytes');
    expect(accepts(KdfParamsSchema, new Map<string, unknown>([['kdf', 'argon2id'], ['m_kib', 32768n], ['t', 2n], ['p', 1n], ['v', 19n], ['enc_salt', b(15)]]))).toBe(false);
  });
});

describe('op-envelope.cddl and zod agree', () => {
  it('KDF ranges in the CDDL match the OpenAPI minimums', () => {
    const m = /m_kib: (\d+)\.\.\d+, t: (\d+)\.\.\d+, p: (\d+)\.\.\d+/.exec(cddl);
    const iter = /iter: (\d+)\.\./.exec(cddl);
    expect(m && iter).toBeTruthy();
    const kdf = openapi.components.schemas.KdfParams.properties;
    expect([Number(m![1]), Number(m![2]), Number(m![3]), Number(iter![1])]).toEqual([kdf.m_kib.minimum, kdf.t.minimum, kdf.p.minimum, kdf.iter.minimum]);
  });

  it('log entry types match the CDDL alternatives exactly', () => {
    const line = /type: ((?:"[a-z_]+"(?: \/ )?)+),/.exec(cddl)![1]!;
    const cddlTypes = [...line.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect([...LOG_ENTRY_TYPES]).toEqual(cddlTypes);
  });

  it('log entry scopes match the CDDL', () => {
    const scopes = [...(/scope: ("full" \/ "from_join")/.exec(cddl)![1]!).matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(scopes).toEqual(['full', 'from_join']);
    const entry = { idx: 0n, prev: b(32), type: 'leave', subject: b(1), signer: b(1), ts: 0n, sig: b(64) };
    const asMap = (o: Record<string, unknown>) => new Map(Object.entries(o));
    for (const scope of scopes) expect(accepts(LogEntrySchema, asMap({ ...entry, scope }))).toBe(true);
    expect(accepts(LogEntrySchema, asMap({ ...entry, scope: 'partial' }))).toBe(false);
  });

  it('table codes are 1..14 as in the CDDL', () => {
    expect(cddl).toContain('table-code = 1..14');
  });

  it('roles are 1..3 as in the CDDL', () => {
    expect(cddl).toMatch(/role: 1\.\.3/);
  });

  it('the key-set fields in the CDDL are exactly the ones the schema requires', () => {
    const block = /keyset = \{([\s\S]*?)\n\}/.exec(cddl)![1]!;
    const cddlFields = [...block.matchAll(/^  (\w+):/gm)].map((x) => x[1]);
    expect(cddlFields).toEqual(['v', 'uuid', 'enc', 'sig', 'kdf', 'encrypted_by']);
    expect(Object.keys(KeySetSchema.out.shape)).toEqual(cddlFields);
  });
});

describe('push result errors', () => {
  it('match the OpenAPI enum', () => {
    expect([...PUSH_ERROR_CODES]).toEqual(openapi.components.schemas.PushResult.properties.error.enum);
  });
});
