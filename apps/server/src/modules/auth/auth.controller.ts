import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ClientIp, Payload, Public } from '../../common/http.js';
import { T } from '../../common/tokens.js';
import { HelloBody, kdfToWire, parseBody, ProofABody, ProofM1Body } from '../../common/wire.js';
import type { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(T.AUTH) private readonly auth: AuthService) {}

  @Public() @Post('hello') @HttpCode(200)
  async hello(@Payload() raw: unknown, @ClientIp() ip: string): Promise<unknown> {
    const b = parseBody(raw, HelloBody);
    const r = await this.auth.hello({ email: b.email, deviceId: b.device_id, ip, credential: b.credential });
    return { account_id: r.accountId, auth_salt: r.authSalt, kdf: kdfToWire(r.kdf), session_id: r.sessionId };
  }

  @Public() @Post('proof-a') @HttpCode(200)
  async proofA(@Payload() raw: unknown, @ClientIp() ip: string): Promise<unknown> {
    const b = parseBody(raw, ProofABody);
    return { B: (await this.auth.proofA({ sessionId: b.session_id, A: b.A, ip })).B };
  }

  @Public() @Post('proof-m1') @HttpCode(200)
  async proofM1(@Payload() raw: unknown, @ClientIp() ip: string): Promise<unknown> {
    const b = parseBody(raw, ProofM1Body);
    return { M2: (await this.auth.proofM1({ sessionId: b.session_id, M1: b.M1, ip })).M2 };
  }
}
