import pg from 'pg';
import { migrate } from './migrate.js';
import type { AccountRow, Bytes, DeviceRow, KdfRecord, OpRow, PushOutcome, RateTableRow, Store, StoredOp } from './store.js';

// PostgreSQL implementation of the Store. Everything stored is ciphertext or routing metadata (ARCHITECTURE 9.7).

type Row = Record<string, unknown>;
const buf = (b: Bytes): Buffer => Buffer.from(b);
const num = (v: unknown): number => Number(v);
const big = (v: unknown): bigint => BigInt(v as string | number | bigint);
const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function kdfToJson(k: KdfRecord): Record<string, unknown> {
  return { kdf: k.kdf, m_kib: k.mKib, t: k.t, p: k.p, iter: k.iter, enc_salt: Buffer.from(k.encSalt).toString('hex') };
}
function kdfFromJson(j: Record<string, unknown>): KdfRecord {
  const optional = (key: string): number | undefined => (j[key] === undefined || j[key] === null ? undefined : Number(j[key]));
  return {
    kdf: j['kdf'] as KdfRecord['kdf'],
    ...(optional('m_kib') !== undefined && { mKib: optional('m_kib')! }),
    ...(optional('t') !== undefined && { t: optional('t')! }),
    ...(optional('p') !== undefined && { p: optional('p')! }),
    ...(optional('iter') !== undefined && { iter: optional('iter')! }),
    encSalt: Buffer.from(String(j['enc_salt']), 'hex'),
  };
}

const accountFrom = (r: Row): AccountRow => ({
  accountId: r['account_id'] as string, emailHmac: r['email_hmac'] as Buffer, email: r['email'] as string, authSalt: r['auth_salt'] as Buffer,
  kdf: kdfFromJson(r['kdf'] as Record<string, unknown>), srpVerifier: r['srp_v'] as Buffer, keyset: r['keyset'] as Buffer,
  failCount: num(r['fail_count']), lockedUntilMs: optNum(r['locked_until']), emailVerifiedAtMs: optNum(r['email_verified_at']),
  discoverable: r['discoverable'] as boolean, bundleSig: (r['bundle_sig'] as Buffer | null) ?? null, createdAtMs: num(r['created_at']),
});
const deviceFrom = (r: Row): DeviceRow => ({
  devId: r['dev_id'] as Buffer, accountId: r['account_id'] as string, sigPk: r['sig_pk'] as Buffer, labelCt: (r['label_ct'] as Buffer | null) ?? null,
  createdAtMs: num(r['created_at']), revokedAtMs: optNum(r['revoked_at']),
});
const opFrom = (r: Row): StoredOp => ({
  serverSeq: big(r['server_seq']), opId: r['op_id'] as Buffer, recId: r['rec_id'] as Buffer, devId: r['dev_id'] as Buffer, devSeq: big(r['dev_seq']),
  hlcWall: num(r['hlc_wall']), hlcCtr: num(r['hlc_ctr']), epoch: num(r['epoch']), schemaVer: num(r['schema_ver']), blob: r['blob'] as Buffer, sig: r['sig'] as Buffer,
});

const isUnique = (e: unknown): e is { constraint: string } => (e as { code?: string }).code === '23505';

export async function createPgStore(databaseUrl: string, options: { migrations?: string } = {}): Promise<Store> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool, options.migrations);
  } catch (e) {
    await pool.end();
    throw e;
  }
  const q = async (text: string, values: unknown[] = []): Promise<Row[]> => (await pool.query(text, values)).rows as Row[];

  async function inTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    accounts: {
      async create(a) {
        try {
          await q(
            `INSERT INTO account(account_id, email_hmac, email, auth_salt, kdf, srp_v, keyset, discoverable, created_at, bundle_sig) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [a.accountId, buf(a.emailHmac), a.email, buf(a.authSalt), JSON.stringify(kdfToJson(a.kdf)), buf(a.srpVerifier), buf(a.keyset), a.discoverable, a.createdAtMs, a.bundleSig === undefined || a.bundleSig === null ? null : buf(a.bundleSig)],
          );
          return 'ok';
        } catch (e) {
          if (isUnique(e)) return e.constraint.includes('email') ? 'email_taken' : 'id_taken';
          throw e;
        }
      },
      async byEmailHmac(h) {
        const r = await q('SELECT * FROM account WHERE email_hmac = $1', [buf(h)]);
        return r[0] === undefined ? undefined : accountFrom(r[0]);
      },
      async byId(id) {
        const r = await q('SELECT * FROM account WHERE account_id = $1', [id]);
        return r[0] === undefined ? undefined : accountFrom(r[0]);
      },
      async replaceCredentials(id, n) {
        await q('UPDATE account SET auth_salt=$2, kdf=$3, srp_v=$4, keyset=$5, fail_count=0, locked_until=NULL WHERE account_id=$1', [
          id, buf(n.authSalt), JSON.stringify(kdfToJson(n.kdf)), buf(n.srpVerifier), buf(n.keyset),
        ]);
      },
      async recordFailure(id, lockedUntilMs) {
        const r = await q('UPDATE account SET fail_count = fail_count + 1, locked_until = $2 WHERE account_id = $1 RETURNING fail_count', [id, lockedUntilMs]);
        return r[0] === undefined ? 0 : num(r[0]['fail_count']);
      },
      async clearFailures(id) {
        await q('UPDATE account SET fail_count = 0, locked_until = NULL WHERE account_id = $1', [id]);
      },
      async setEmailVerified(id, atMs) {
        await q('UPDATE account SET email_verified_at = $2 WHERE account_id = $1', [id, atMs]);
      },
      async setDiscoverable(id, value) {
        await q('UPDATE account SET discoverable = $2 WHERE account_id = $1', [id, value]);
      },
      async remove(id, atMs) {
        await inTransaction(async (c) => {
          await c.query('DELETE FROM account WHERE account_id = $1', [id]);
          await c.query('INSERT INTO tombstone_account(account_id, deleted_at) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, atMs]);
        });
      },
      async isTombstoned(id) {
        return (await q('SELECT 1 FROM tombstone_account WHERE account_id = $1', [id])).length > 0;
      },
    },
    recovery: {
      async get(id) {
        const r = await q('SELECT * FROM account_recovery WHERE account_id = $1', [id]);
        return r[0] === undefined ? undefined : { uuid: r[0]['uuid'] as Buffer, authSalt: r[0]['auth_salt'] as Buffer, srpVerifier: r[0]['srp_v'] as Buffer, wrapped: r[0]['wrapped'] as Buffer };
      },
      async put(id, row) {
        await q(
          `INSERT INTO account_recovery(account_id, uuid, auth_salt, srp_v, wrapped) SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM account WHERE account_id = $1)
           ON CONFLICT (account_id) DO UPDATE SET uuid = EXCLUDED.uuid, auth_salt = EXCLUDED.auth_salt, srp_v = EXCLUDED.srp_v, wrapped = EXCLUDED.wrapped`,
          [id, buf(row.uuid), buf(row.authSalt), buf(row.srpVerifier), buf(row.wrapped)],
        );
      },
      async remove(id) {
        await q('DELETE FROM account_recovery WHERE account_id = $1', [id]);
      },
    },
    devices: {
      async add(d) {
        try {
          await q('INSERT INTO device(dev_id, account_id, sig_pk, label_ct, created_at) VALUES ($1,$2,$3,$4,$5)', [buf(d.devId), d.accountId, buf(d.sigPk), d.labelCt === null ? null : buf(d.labelCt), d.createdAtMs]);
          return 'ok';
        } catch (e) {
          if (isUnique(e)) return 'exists';
          throw e;
        }
      },
      async list(accountId) {
        return (await q('SELECT * FROM device WHERE account_id = $1 ORDER BY created_at, dev_id', [accountId])).map(deviceFrom);
      },
      async get(devId) {
        const r = await q('SELECT * FROM device WHERE dev_id = $1', [buf(devId)]);
        return r[0] === undefined ? undefined : deviceFrom(r[0]);
      },
      async revoke(accountId, devId, atMs) {
        return (await q('UPDATE device SET revoked_at = $3 WHERE dev_id = $2 AND account_id = $1 AND revoked_at IS NULL RETURNING 1', [accountId, buf(devId), atMs])).length > 0;
      },
      async setLabel(accountId, devId, labelCt) {
        return (await q('UPDATE device SET label_ct = $3 WHERE dev_id = $2 AND account_id = $1 AND revoked_at IS NULL RETURNING 1', [accountId, buf(devId), labelCt === null ? null : buf(labelCt)])).length > 0;
      },
    },
    emailVerification: {
      async put(accountId, tokenHash, expiresAtMs) {
        await q('INSERT INTO email_verification(account_id, token_hash, expires_at) VALUES ($1,$2,$3) ON CONFLICT (account_id, token_hash) DO UPDATE SET expires_at = $3, used_at = NULL', [accountId, buf(tokenHash), expiresAtMs]);
      },
      async consume(tokenHash, nowMs) {
        const r = await q('UPDATE email_verification SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING account_id', [buf(tokenHash), nowMs]);
        return r[0]?.['account_id'] as string | undefined;
      },
    },
    folds: {
      async create(foldId, owner, atMs) {
        return inTransaction(async (c) => {
          const made = await c.query('INSERT INTO fold(fold_id, created_at) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1', [buf(foldId), atMs]);
          if (made.rowCount === 0) return 'exists' as const;
          await c.query('INSERT INTO fold_member(fold_id, member, role) VALUES ($1,$2,1)', [buf(foldId), owner]);
          return 'ok' as const;
        });
      },
      async list(accountId) {
        const r = await q(
          'SELECT f.fold_id, f.head_seq FROM fold f JOIN fold_member m ON m.fold_id = f.fold_id WHERE m.member = $1 AND m.removed_at IS NULL ORDER BY f.created_at, f.fold_id',
          [accountId],
        );
        return r.map((x) => ({ foldId: x['fold_id'] as Buffer, headSeq: big(x['head_seq']) }));
      },
      async roleOf(foldId, accountId) {
        const r = await q('SELECT role FROM fold_member WHERE fold_id = $1 AND member = $2 AND removed_at IS NULL', [buf(foldId), accountId]);
        return r[0] === undefined ? undefined : num(r[0]['role']);
      },
      async member(foldId, accountId) {
        const r = await q('SELECT role, from_epoch, removed_at FROM fold_member WHERE fold_id = $1 AND member = $2', [buf(foldId), accountId]);
        return r[0] === undefined ? undefined : { role: num(r[0]['role']), fromEpoch: num(r[0]['from_epoch']), removedAtMs: optNum(r[0]['removed_at']) };
      },
      async addMember(foldId, accountId, role, fromEpoch) {
        await q(
          `INSERT INTO fold_member(fold_id, member, role, from_epoch) VALUES ($1,$2,$3,$4)
           ON CONFLICT (fold_id, member) DO UPDATE SET role = EXCLUDED.role, from_epoch = EXCLUDED.from_epoch, removed_at = NULL`,
          [buf(foldId), accountId, role, fromEpoch],
        );
      },
      async setRole(foldId, accountId, role) {
        await q('UPDATE fold_member SET role = $3 WHERE fold_id = $1 AND member = $2', [buf(foldId), accountId, role]);
      },
      async removeMember(foldId, accountId, atMs) {
        await q('UPDATE fold_member SET removed_at = $3 WHERE fold_id = $1 AND member = $2', [buf(foldId), accountId, atMs]);
      },
      async members(foldId) {
        return (await q('SELECT member FROM fold_member WHERE fold_id = $1 AND removed_at IS NULL ORDER BY member', [buf(foldId)])).map((x) => x['member'] as string);
      },
      async remove(foldId) {
        await q('DELETE FROM fold WHERE fold_id = $1', [buf(foldId)]);
      },
    },
    log: {
      async append(foldId, idx, entry, hash) {
        // The fold row is the lock that orders concurrent appends, so the chain has no gaps and no forks.
        return inTransaction(async (c) => {
          const locked = await c.query('SELECT 1 FROM fold WHERE fold_id = $1 FOR UPDATE', [buf(foldId)]);
          if (locked.rowCount === 0) return 'conflict' as const;
          const last = await c.query('SELECT COALESCE(MAX(idx), -1) AS head FROM fold_log WHERE fold_id = $1', [buf(foldId)]);
          if (num(last.rows[0]['head']) + 1 !== idx) return 'conflict' as const;
          await c.query('INSERT INTO fold_log(fold_id, idx, entry, hash) VALUES ($1,$2,$3,$4)', [buf(foldId), idx, buf(entry), buf(hash)]);
          return 'ok' as const;
        });
      },
      async list(foldId, after) {
        const rows = await q('SELECT entry FROM fold_log WHERE fold_id = $1 AND idx > $2 ORDER BY idx', [buf(foldId), after]);
        const head = await q('SELECT COALESCE(MAX(idx), -1) AS head FROM fold_log WHERE fold_id = $1', [buf(foldId)]);
        return { entries: rows.map((r) => r['entry'] as Buffer), head: num(head[0]!['head']) };
      },
      async last(foldId) {
        const r = await q('SELECT idx, hash, entry FROM fold_log WHERE fold_id = $1 ORDER BY idx DESC LIMIT 1', [buf(foldId)]);
        return r[0] === undefined ? undefined : { idx: num(r[0]['idx']), hash: r[0]['hash'] as Buffer, entry: r[0]['entry'] as Buffer };
      },
    },
    grants: {
      async put(foldId, member, epoch, grant) {
        await q(
          'INSERT INTO fold_grant(fold_id, member, epoch, grant_bytes) VALUES ($1,$2,$3,$4) ON CONFLICT (fold_id, member, epoch) DO UPDATE SET grant_bytes = EXCLUDED.grant_bytes',
          [buf(foldId), member, epoch, buf(grant)],
        );
      },
      async forMember(foldId, member) {
        return (await q('SELECT grant_bytes FROM fold_grant WHERE fold_id = $1 AND member = $2 ORDER BY epoch', [buf(foldId), member])).map((r) => r['grant_bytes'] as Buffer);
      },
    },
    ops: {
      async push(foldId, ops) {
        return inTransaction(async (c) => {
          // The fold row is the lock that orders concurrent pushes, so server_seq is gapless and monotone. Everything else is set-based:
          // one lookup for operations already stored, one for each device's last sequence number, one insert (load test, ADR-0007).
          const locked = await c.query('SELECT head_seq FROM fold WHERE fold_id = $1 FOR UPDATE', [buf(foldId)]);
          if (locked.rowCount === 0) return ops.map((o): PushOutcome => ({ op: o.opId, status: 'seq_gap' }));
          let head = big(locked.rows[0]['head_seq']);
          const hexOf = (b: Uint8Array): string => Buffer.from(b).toString('hex');

          const known = new Map<string, bigint>();
          const stored = await c.query('SELECT op_id, server_seq FROM op WHERE fold_id = $1 AND op_id = ANY($2::bytea[])', [buf(foldId), ops.map((o) => buf(o.opId))]);
          for (const r of stored.rows) known.set(hexOf(r['op_id'] as Buffer), big(r['server_seq']));
          const lastSeq = new Map<string, bigint>();
          const devices = [...new Set(ops.map((o) => hexOf(o.devId)))];
          const seen = await c.query('SELECT dev_id, last_seq FROM device_seq WHERE fold_id = $1 AND dev_id = ANY($2::bytea[])', [buf(foldId), devices.map((d) => Buffer.from(d, 'hex'))]);
          for (const r of seen.rows) lastSeq.set(hexOf(r['dev_id'] as Buffer), big(r['last_seq']));

          const out: PushOutcome[] = [];
          const accepted: Array<{ o: OpRow; seq: bigint }> = [];
          const touched = new Set<string>();
          for (const o of ops) {
            const id = hexOf(o.opId);
            const dup = known.get(id);
            if (dup !== undefined) {
              out.push({ op: o.opId, status: 'duplicate', serverSeq: dup });
              continue;
            }
            const dev = hexOf(o.devId);
            const last = lastSeq.get(dev) ?? 0n;
            if (o.devSeq <= last) out.push({ op: o.opId, status: 'seq_conflict' });
            else if (o.devSeq !== last + 1n) out.push({ op: o.opId, status: 'seq_gap' });
            else {
              head += 1n;
              accepted.push({ o, seq: head });
              known.set(id, head);
              lastSeq.set(dev, o.devSeq);
              touched.add(dev);
              out.push({ op: o.opId, status: 'stored', serverSeq: head });
            }
          }
          if (accepted.length > 0) {
            await c.query(
              `INSERT INTO op(fold_id, server_seq, op_id, rec_id, dev_id, dev_seq, hlc_wall, hlc_ctr, epoch, schema_ver, blob, sig)
               SELECT $1, * FROM unnest($2::bigint[], $3::bytea[], $4::bytea[], $5::bytea[], $6::bigint[], $7::bigint[], $8::int[], $9::int[], $10::int[], $11::bytea[], $12::bytea[])`,
              [
                buf(foldId), accepted.map((a) => a.seq.toString()), accepted.map((a) => buf(a.o.opId)), accepted.map((a) => buf(a.o.recId)), accepted.map((a) => buf(a.o.devId)),
                accepted.map((a) => a.o.devSeq.toString()), accepted.map((a) => a.o.hlcWall), accepted.map((a) => a.o.hlcCtr), accepted.map((a) => a.o.epoch), accepted.map((a) => a.o.schemaVer),
                accepted.map((a) => buf(a.o.blob)), accepted.map((a) => buf(a.o.sig)),
              ],
            );
            for (const dev of touched) {
              await c.query('INSERT INTO device_seq(fold_id, dev_id, last_seq) VALUES ($1,$2,$3) ON CONFLICT (fold_id, dev_id) DO UPDATE SET last_seq = $3', [buf(foldId), Buffer.from(dev, 'hex'), (lastSeq.get(dev) ?? 0n).toString()]);
            }
          }
          await c.query('UPDATE fold SET head_seq = $2 WHERE fold_id = $1', [buf(foldId), head.toString()]);
          return out;
        });
      },
      async pull(foldId, after, limit, minEpoch = 0) {
        const rows = await q('SELECT * FROM op WHERE fold_id = $1 AND server_seq > $2 AND epoch >= $4 ORDER BY server_seq LIMIT $3', [buf(foldId), after.toString(), limit + 1, minEpoch]);
        const head = await q('SELECT head_seq FROM fold WHERE fold_id = $1', [buf(foldId)]);
        return { ops: rows.slice(0, limit).map(opFrom), head: head[0] === undefined ? 0n : big(head[0]['head_seq']), more: rows.length > limit };
      },
      async head(foldId) {
        const r = await q('SELECT head_seq FROM fold WHERE fold_id = $1', [buf(foldId)]);
        return r[0] === undefined ? 0n : big(r[0]['head_seq']);
      },
      async lastDevSeq(foldId, devId) {
        const r = await q('SELECT last_seq FROM device_seq WHERE fold_id = $1 AND dev_id = $2', [buf(foldId), buf(devId)]);
        return r[0] === undefined ? 0n : big(r[0]['last_seq']);
      },
    },
    snapshots: {
      async put(s) {
        await q(
          `INSERT INTO snapshot(fold_id, at_seq, epoch, blob, sig) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (fold_id) DO UPDATE SET at_seq = EXCLUDED.at_seq, epoch = EXCLUDED.epoch, blob = EXCLUDED.blob, sig = EXCLUDED.sig WHERE snapshot.at_seq <= EXCLUDED.at_seq`,
          [buf(s.foldId), s.atSeq.toString(), s.epoch, buf(s.blob), buf(s.sig)],
        );
      },
      async get(foldId) {
        const r = await q('SELECT * FROM snapshot WHERE fold_id = $1', [buf(foldId)]);
        return r[0] === undefined ? undefined : { foldId: r[0]['fold_id'] as Buffer, atSeq: big(r[0]['at_seq']), epoch: Number(r[0]['epoch']), blob: r[0]['blob'] as Buffer, sig: r[0]['sig'] as Buffer };
      },
      async folds() {
        return (await q('SELECT fold_id FROM snapshot')).map((r) => r['fold_id'] as Buffer);
      },
      async acknowledge(foldId, devId, seq) {
        await q(
          `INSERT INTO snapshot_ack(fold_id, dev_id, seq) VALUES ($1,$2,$3) ON CONFLICT (fold_id, dev_id) DO UPDATE SET seq = GREATEST(snapshot_ack.seq, EXCLUDED.seq)`,
          [buf(foldId), buf(devId), seq.toString()],
        );
      },
      async prune(foldId) {
        return inTransaction(async (c) => {
          const snap = await c.query('SELECT at_seq FROM snapshot WHERE fold_id = $1', [buf(foldId)]);
          if (snap.rowCount === 0) return 0;
          const at = big(snap.rows[0]['at_seq']);
          const behind = await c.query(
            `SELECT 1 FROM device d JOIN fold_member m ON m.member = d.account_id AND m.fold_id = $1 AND m.removed_at IS NULL
             LEFT JOIN snapshot_ack a ON a.fold_id = $1 AND a.dev_id = d.dev_id
             WHERE d.revoked_at IS NULL AND COALESCE(a.seq, 0) < $2 LIMIT 1`,
            [buf(foldId), at.toString()],
          );
          const active = await c.query(
            `SELECT 1 FROM device d JOIN fold_member m ON m.member = d.account_id AND m.fold_id = $1 AND m.removed_at IS NULL WHERE d.revoked_at IS NULL LIMIT 1`,
            [buf(foldId)],
          );
          if ((behind.rowCount ?? 0) > 0 || (active.rowCount ?? 0) === 0) return 0;
          const removed = await c.query('DELETE FROM op WHERE fold_id = $1 AND server_seq <= $2', [buf(foldId), at.toString()]);
          return removed.rowCount ?? 0;
        });
      },
    },
    attachments: {
      async putChunk(foldId, attId, index, data, quota) {
        // One writer at a time per Fold, so the count and the insert cannot be separated by another upload (the lock ends with the transaction).
        return inTransaction(async (c) => {
          await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('attachment:' || encode($1::bytea, 'hex'), 0))`, [buf(foldId)]);
          const had = await c.query('SELECT data FROM attachment_chunk WHERE fold_id = $1 AND att_id = $2 AND idx = $3', [buf(foldId), buf(attId), index]);
          if (had.rows[0] !== undefined) return (had.rows[0]['data'] as Buffer).equals(buf(data)) ? 'ok' : 'conflict';
          if (quota !== undefined) {
            const n = num((await c.query('SELECT count(*) AS n FROM attachment_chunk WHERE fold_id = $1', [buf(foldId)])).rows[0]['n']);
            if (n >= quota) return 'quota';
          }
          await c.query('INSERT INTO attachment_chunk(fold_id, att_id, idx, data) VALUES ($1,$2,$3,$4)', [buf(foldId), buf(attId), index, buf(data)]);
          return 'ok';
        });
      },
      async getChunk(foldId, attId, index) {
        const r = await q('SELECT data FROM attachment_chunk WHERE fold_id = $1 AND att_id = $2 AND idx = $3', [buf(foldId), buf(attId), index]);
        return r[0] === undefined ? undefined : (r[0]['data'] as Buffer);
      },
      async chunkCount(foldId) {
        return num((await q('SELECT count(*) AS n FROM attachment_chunk WHERE fold_id = $1', [buf(foldId)]))[0]!['n']);
      },
    },
    rates: {
      async put(r: RateTableRow) {
        await q('INSERT INTO rate_table(as_of, base, rates, source) VALUES ($1,$2,$3,$4) ON CONFLICT (as_of) DO NOTHING', [r.asOfMs, r.base, JSON.stringify(r.rates), r.source]);
      },
      async latest() {
        const r = await q('SELECT * FROM rate_table ORDER BY as_of DESC LIMIT 1');
        return r[0] === undefined ? undefined : { asOfMs: num(r[0]['as_of']), base: r[0]['base'] as string, source: r[0]['source'] as string, rates: r[0]['rates'] as Record<string, string> };
      },
    },
    async close() {
      await pool.end();
    },
  };
}
export type { OpRow };
