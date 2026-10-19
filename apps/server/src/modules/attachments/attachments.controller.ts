import { Controller, Get, HttpCode, HttpException, Inject, Param, Put } from '@nestjs/common';
import { fromB64url } from '../../common/crypto-util.js';
import { Auth, Payload, type Caller } from '../../common/http.js';
import { T } from '../../common/tokens.js';
import type { Store } from '../../store/store.js';

/** One sealed piece is a 64 KiB frame plus its 16-byte tag; a little slack is allowed for padding. */
export const MAX_CHUNK_BYTES = 65_536 + 16 + 1024;
/** 4,096 pieces of 64 KiB: a single attachment of up to 256 MiB. */
export const MAX_CHUNK_INDEX = 4095;
/** Pieces a Fold may hold in all (1 GiB of 64 KiB pieces), so one Fold cannot fill the service. */
export const FOLD_CHUNK_QUOTA = 16_384;

const fail = (status: number, code: string): never => {
  throw new HttpException({ code }, status);
};
const idOf = (param: string): Buffer => {
  const id = fromB64url(param);
  return id.length === 16 ? id : fail(400, 'bad_request');
};
const indexOf = (param: string): number => {
  const n = /^\d{1,4}$/.test(param) ? Number(param) : -1;
  return n >= 0 && n <= MAX_CHUNK_INDEX ? n : fail(400, 'bad_request');
};

/** The pieces of Fold attachments (FR-093). The relay stores sealed pieces and cannot tell what they are pieces of. */
@Controller('folds')
export class AttachmentsController {
  constructor(@Inject(T.STORE) private readonly store: Store) {}

  @Put(':fold/attachments/:att/chunks/:index') @HttpCode(204)
  async put(@Auth() caller: Caller, @Param('fold') fold: string, @Param('att') att: string, @Param('index') index: string, @Payload() inner: unknown): Promise<void> {
    const [foldId, attId, at] = [idOf(fold), idOf(att), indexOf(index)];
    const role = await this.store.folds.roleOf(foldId, caller.accountId);
    if (role === undefined || role > 2) fail(403, 'forbidden');
    if (!(inner instanceof Uint8Array) || inner.length === 0 || inner.length > MAX_CHUNK_BYTES) fail(400, 'bad_request');
    const data = inner as Uint8Array;
    if ((await this.store.attachments.getChunk(foldId, attId, at)) === undefined && (await this.store.attachments.chunkCount(foldId)) >= FOLD_CHUNK_QUOTA) fail(413, 'quota_exceeded');
    if ((await this.store.attachments.putChunk(foldId, attId, at, data)) === 'conflict') fail(409, 'conflict');
  }

  @Get(':fold/attachments/:att/chunks/:index')
  async get(@Auth() caller: Caller, @Param('fold') fold: string, @Param('att') att: string, @Param('index') index: string): Promise<Uint8Array> {
    const [foldId, attId, at] = [idOf(fold), idOf(att), indexOf(index)];
    if ((await this.store.folds.roleOf(foldId, caller.accountId)) === undefined) fail(403, 'forbidden');
    return (await this.store.attachments.getChunk(foldId, attId, at)) ?? fail(404, 'not_found');
  }
}
