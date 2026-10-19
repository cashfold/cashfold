import { Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query } from '@nestjs/common';
import { fromB64url } from '../../common/crypto-util.js';
import { Auth, Payload, type Caller } from '../../common/http.js';
import { T } from '../../common/tokens.js';
import { InviteBody, LogAppendBody, LookupBody, parseValue } from '../../common/wire.js';
import type { MembershipService, Outcome } from './membership.service.js';

const refuse = (status: number, code: string, retryAfterSec?: number): never => {
  throw new HttpException({ code, ...(retryAfterSec !== undefined && { retryAfter: retryAfterSec }) }, status);
};
const unwrap = <V>(o: Outcome<V>): V => (o.ok ? o.value : refuse(o.status, o.code, o.retryAfterSec));
const foldIdOf = (param: string): Buffer => {
  const id = fromB64url(param);
  return id.length === 16 ? id : refuse(400, 'bad_request');
};
const wireBundle = (b: { accountId: string; encPk: Uint8Array; sigPk: Uint8Array; selfSig: Uint8Array }) => ({ account_id: b.accountId, enc_pk: b.encPk, sig_pk: b.sigPk, self_sig: b.selfSig });

@Controller()
export class MembershipController {
  constructor(@Inject(T.MEMBERSHIP) private readonly membership: MembershipService) {}

  /** Resolves an address to a public key bundle for an invitation. Unknown and hidden addresses look the same (FR-106). */
  @Post('accounts/lookup') @HttpCode(200)
  async lookup(@Auth() caller: Caller, @Payload() inner: unknown): Promise<unknown> {
    const { email } = parseValue(inner, LookupBody);
    return wireBundle(unwrap(await this.membership.lookup(caller.accountId, email)));
  }

  @Get('accounts/:accountId/public-keys')
  async publicKeys(@Auth() caller: Caller, @Param('accountId') accountId: string): Promise<unknown> {
    return wireBundle(unwrap(await this.membership.publicKeys(caller.accountId, accountId)));
  }

  @Get('folds/:fold/log')
  async log(@Auth() caller: Caller, @Param('fold') fold: string, @Query('after') after?: string): Promise<unknown> {
    const from = after === undefined ? -1 : Number(after);
    if (!Number.isInteger(from) || from < -1) refuse(400, 'bad_request');
    const { entries, head } = unwrap(await this.membership.readLog(foldIdOf(fold), caller.accountId, from));
    return { entries: [...entries], head: BigInt(head) };
  }

  @Post('folds/:fold/log') @HttpCode(201)
  async append(@Auth() caller: Caller, @Param('fold') fold: string, @Payload() inner: unknown): Promise<void> {
    const b = parseValue(inner, LogAppendBody);
    unwrap(await this.membership.append(foldIdOf(fold), caller.accountId, b.entry, b.grants ?? [], 'log'));
  }

  /** Appends an `add_member` entry with its grants and tells the invitee, naming only the sender (FR-107). */
  @Post('folds/:fold/invitations') @HttpCode(201)
  async invite(@Auth() caller: Caller, @Param('fold') fold: string, @Payload() inner: unknown): Promise<void> {
    const b = parseValue(inner, InviteBody);
    unwrap(await this.membership.append(foldIdOf(fold), caller.accountId, b.entry, b.grants ?? [], 'invite'));
  }
}
