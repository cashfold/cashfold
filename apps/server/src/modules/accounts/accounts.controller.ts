import { Controller, Delete, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Auth, ClientIp, ALLOW_UNREGISTERED_DEVICE, Payload, Public, type Caller } from '../../common/http.js';
import { T } from '../../common/tokens.js';
import { kdfToWire, CredentialRotationBody, DiscoverableBody, parseBody, parseValue, RecoveryBody, RegistrationBody, textMap, VerifyEmailBody } from '../../common/wire.js';
import type { AccountsService } from './accounts.service.js';
import { SetMetadata, HttpException } from '@nestjs/common';

const AllowUnregistered = () => SetMetadata(ALLOW_UNREGISTERED_DEVICE, true);
const fail = (status: number, code: string): never => {
  throw new HttpException({ code }, status);
};
const DeleteBody = textMap({ fresh_proof: z.custom<Uint8Array>((v) => v instanceof Uint8Array && v.length === 32), removal_entries: z.array(z.unknown()).optional() });

@Controller('accounts')
export class AccountsController {
  constructor(@Inject(T.ACCOUNTS) private readonly accounts: AccountsService) {}

  @Public() @Post() @HttpCode(201)
  async register(@Payload() raw: unknown, @ClientIp() ip: string, @Req() req: FastifyRequest): Promise<void> {
    const b = parseBody(raw, RegistrationBody);
    const invite = typeof req.headers['x-invite-code'] === 'string' ? req.headers['x-invite-code'] : undefined;
    const r = await this.accounts.register(
      { accountId: b.account_id, email: b.email, authSalt: b.auth_salt, kdf: b.kdf, srpVerifier: b.srp_verifier, keyset: b.keyset, discoverable: b.discoverable ?? true, bundleSig: b.bundle_sig, invite, device: { devId: b.device.dev_id, sigPk: b.device.sig_pk, labelCt: b.device.label_ct } },
      ip,
    );
    if (!r.ok) fail(r.status, r.code);
  }

  @Public() @Post('verify-email') @HttpCode(204)
  async verify(@Payload() raw: unknown, @ClientIp() ip: string): Promise<void> {
    const r = await this.accounts.verifyEmail(parseBody(raw, VerifyEmailBody).token, ip);
    if (!r.ok) fail(r.status, r.code);
  }

  @Get('me')
  async me(@Auth() caller: Caller): Promise<unknown> {
    const s = await this.accounts.status(caller.accountId);
    return s === undefined ? fail(404, 'not_found') : { account_id: s.accountId, email_verified: s.emailVerified, verification: s.verification, discoverable: s.discoverable };
  }

  @AllowUnregistered() @Get('me/keyset')
  async keyset(@Auth() caller: Caller): Promise<unknown> {
    const k = await this.accounts.keyset(caller.accountId);
    return k === undefined ? fail(404, 'not_found') : { keyset: k.keyset, auth_salt: k.authSalt, kdf: kdfToWire(k.kdf) };
  }

  @Put('me/keyset') @HttpCode(204)
  async rotate(@Auth() caller: Caller, @Payload() inner: unknown): Promise<void> {
    const b = parseValue(inner, CredentialRotationBody);
    await this.accounts.rotate(caller.accountId, Buffer.from(caller.sessionId).toString('hex'), { authSalt: b.auth_salt, kdf: b.kdf, srpVerifier: b.srp_verifier, keyset: b.keyset });
  }

  @Put('me/recovery') @HttpCode(204)
  async setRecovery(@Auth() caller: Caller, @Payload() inner: unknown): Promise<void> {
    const b = parseValue(inner, RecoveryBody);
    await this.accounts.setRecovery(caller.accountId, { uuid: b.uuid, authSalt: b.auth_salt, srpVerifier: b.srp_verifier, wrapped: b.wrapped });
  }

  @Get('me/recovery')
  async recovery(@Auth() caller: Caller): Promise<unknown> {
    const r = await this.accounts.recovery(caller.accountId);
    return r === undefined ? fail(404, 'not_found') : { uuid: r.uuid, wrapped: r.wrapped, keyset: r.keyset };
  }

  @Delete('me/recovery') @HttpCode(204)
  async clearRecovery(@Auth() caller: Caller): Promise<void> {
    await this.accounts.clearRecovery(caller.accountId);
  }

  @Put('me/discoverable') @HttpCode(204)
  async discoverable(@Auth() caller: Caller, @Payload() inner: unknown): Promise<void> {
    await this.accounts.setDiscoverable(caller.accountId, parseValue(inner, DiscoverableBody).discoverable);
  }

  @Post('me/verification') @HttpCode(204)
  async resend(@Auth() caller: Caller): Promise<void> {
    await this.accounts.resendVerification(caller.accountId);
  }

  @Delete('me') @HttpCode(204)
  async remove(@Auth() caller: Caller, @Payload() inner: unknown): Promise<void> {
    const b = parseValue(inner, DeleteBody);
    const r = await this.accounts.remove(caller.accountId, Buffer.from(caller.sessionId).toString('hex'), b.fresh_proof);
    if (!r.ok) fail(r.status, r.code);
  }
}
