import { Controller, Delete, Get, HttpCode, HttpException, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { fromB64url } from '../../common/crypto-util.js';
import { Auth, Payload, type Caller } from '../../common/http.js';
import type { Clock } from '../../common/rate-limit.js';
import { T } from '../../common/tokens.js';
import { AckBody, CreateFoldBody, parseValue, SnapshotBody } from '../../common/wire.js';
import type { Store, StoredOp } from '../../store/store.js';
import { PULL_LIMIT, type FoldsService } from './folds.service.js';
import type { MembershipService } from '../membership/membership.service.js';
import { decodeFoldKeyGrant, encodeOpEnvelope } from '@cashfold/protocol';

const fail = (status: number, code: string): never => {
  throw new HttpException({ code }, status);
};
const foldIdOf = (param: string): Buffer => {
  const id = fromB64url(param);
  return id.length === 16 ? id : fail(400, 'bad_request');
};
const PushBody = z.array(z.custom<Uint8Array>((v) => v instanceof Uint8Array)).max(1024);

@Controller('folds')
export class FoldsController {
  constructor(
    @Inject(T.STORE) private readonly store: Store,
    @Inject(T.FOLDS) private readonly folds: FoldsService,
    @Inject(T.CLOCK) private readonly clock: Clock,
    @Inject(T.MEMBERSHIP) private readonly membership: MembershipService,
  ) {}

  @Post() @HttpCode(201)
  async create(@Auth() caller: Caller, @Payload() inner: unknown): Promise<void> {
    const b = parseValue(inner, CreateFoldBody);
    // The owner's own grant of the first key arrives with the Fold, so a new device of the same account can open it.
    // The relay checks its shape and addressee, never its content: it cannot open it, and clients check the signature.
    let grant: { epoch: number; bytes: Uint8Array } | undefined;
    if (b.grant !== undefined) {
      try {
        const g = decodeFoldKeyGrant(b.grant);
        if (Buffer.from(g.member).toString('utf8') !== caller.accountId || Buffer.compare(g.fold, b.fold) !== 0) return fail(400, 'bad_request');
        grant = { epoch: g.epoch, bytes: b.grant };
      } catch {
        return fail(400, 'bad_request');
      }
    }
    if ((await this.folds.create(b.fold, caller.accountId, this.clock.now())) === 'exists') fail(409, 'exists');
    if (b.genesis !== undefined) {
      // The first entry of the Fold's log comes with the Fold. If it is refused the Fold is not left half made.
      const first = await this.membership.append(b.fold, caller.accountId, b.genesis, [], 'log');
      if (!first.ok) {
        await this.store.folds.remove(b.fold);
        return fail(first.status, first.code);
      }
    }
    if (grant !== undefined) await this.store.grants.put(b.fold, caller.accountId, grant.epoch, grant.bytes);
  }

  /** The grants addressed to the caller, one per epoch the caller may read. */
  @Get(':fold/grants')
  async grants(@Auth() caller: Caller, @Param('fold') fold: string, @Query('member') member?: string): Promise<unknown> {
    const id = foldIdOf(fold);
    if (member !== 'me') fail(400, 'bad_request');
    if ((await this.store.folds.roleOf(id, caller.accountId)) === undefined) fail(403, 'forbidden');
    return [...(await this.store.grants.forMember(id, caller.accountId))];
  }

  @Get()
  async list(@Auth() caller: Caller): Promise<unknown> {
    return (await this.store.folds.list(caller.accountId)).map((f) => ({ fold: f.foldId, head_seq: f.headSeq }));
  }

  @Delete(':fold') @HttpCode(204)
  async remove(@Auth() caller: Caller, @Param('fold') fold: string): Promise<void> {
    const id = foldIdOf(fold);
    if ((await this.store.folds.roleOf(id, caller.accountId)) !== 1) fail(403, 'owner_only');
    await this.store.folds.remove(id);
  }

  @Post(':fold/ops')
  @HttpCode(200)
  async push(@Auth() caller: Caller, @Param('fold') fold: string, @Payload() inner: unknown): Promise<unknown> {
    const parsed = PushBody.safeParse(inner);
    if (!parsed.success) fail(400, 'bad_request');
    const r = await this.folds.push(foldIdOf(fold), caller.accountId, caller.deviceId, caller.device?.sigPk, parsed.data!);
    if (r.status !== 200) fail(r.status, r.status === 413 ? 'too_large' : 'forbidden');
    return r.results.map((x) => ({ op: x.op, ...(x.serverSeq !== undefined && { server_seq: x.serverSeq }), ...(x.error !== undefined && { error: x.error }) }));
  }

  @Get(':fold/ops')
  async pull(@Auth() caller: Caller, @Param('fold') fold: string, @Query('after') after: string, @Query('limit') limit?: string): Promise<unknown> {
    if (!/^\d{1,18}$/.test(after ?? '')) fail(400, 'bad_request');
    const take = limit === undefined ? PULL_LIMIT : Number(limit);
    if (!Number.isInteger(take) || take < 1 || take > PULL_LIMIT) fail(400, 'bad_request');
    const page = await this.folds.pull(foldIdOf(fold), caller.accountId, BigInt(after), take);
    if (page === undefined) return fail(403, 'forbidden');
    return {
      ops: page.ops.map((o) => ({ server_seq: o.serverSeq, op: encodeEnvelope(foldIdOf(fold), o) })),
      head: page.head,
      more: page.more,
    };
  }

  @Get(':fold/snapshot')
  async snapshot(@Auth() caller: Caller, @Param('fold') fold: string): Promise<unknown> {
    const id = foldIdOf(fold);
    if ((await this.store.folds.roleOf(id, caller.accountId)) === undefined) fail(403, 'forbidden');
    const s = await this.store.snapshots.get(id);
    // A snapshot of a state written under keys this member never had is of no use to them, and is not theirs to read (FR-102).
    const mine = await this.store.folds.member(id, caller.accountId);
    return s === undefined || (mine !== undefined && s.epoch < mine.fromEpoch) ? fail(404, 'not_found') : { fold: id, at_seq: s.atSeq, epoch: BigInt(s.epoch), blob: s.blob, sig: s.sig };
  }

  @Put(':fold/snapshot') @HttpCode(204)
  async putSnapshot(@Auth() caller: Caller, @Param('fold') fold: string, @Payload() inner: unknown): Promise<void> {
    const id = foldIdOf(fold);
    const role = await this.store.folds.roleOf(id, caller.accountId);
    if (role === undefined || role > 2) fail(403, 'forbidden');
    // A snapshot stands in for the log below it. One made by a member who cannot see the early history would erase it for the others.
    if ((await this.store.folds.member(id, caller.accountId))!.fromEpoch !== 1) fail(403, 'forbidden');
    const b = parseValue(inner, SnapshotBody);
    if (Buffer.from(b.fold).compare(id) !== 0) fail(400, 'bad_request');
    if (b.at_seq > (await this.store.ops.head(id))) fail(400, 'bad_request'); // a snapshot cannot be ahead of the log
    await this.store.snapshots.put({ foldId: id, atSeq: b.at_seq, epoch: b.epoch, blob: b.blob, sig: b.sig });
  }

  /** A device says it holds everything up to `seq` (and has verified the snapshot, if any). Pruning follows when all have. */
  @Post(':fold/ack') @HttpCode(204)
  async ack(@Auth() caller: Caller, @Param('fold') fold: string, @Payload() inner: unknown): Promise<void> {
    const id = foldIdOf(fold);
    if ((await this.store.folds.roleOf(id, caller.accountId)) === undefined) fail(403, 'forbidden');
    const { seq } = parseValue(inner, AckBody);
    await this.store.snapshots.acknowledge(id, caller.deviceId, seq);
    await this.store.snapshots.prune(id);
  }
}

/** The envelope exactly as its author sent it, rebuilt from the stored columns (op-envelope.cddl). */
function encodeEnvelope(fold: Uint8Array, o: StoredOp): Uint8Array {
  return encodeOpEnvelope({ v: 1, fold, op: o.opId, rec: o.recId, dev: o.devId, seq: o.devSeq, hlc: { wallMs: o.hlcWall, ctr: o.hlcCtr }, epoch: o.epoch, schema: o.schemaVer, blob: o.blob, sig: o.sig });
}
