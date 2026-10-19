import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromB64url } from '../../common/crypto-util.js';
import { ALLOW_UNREGISTERED_DEVICE, PUBLIC, readInner, type CfRequest } from '../../common/http.js';
import { T } from '../../common/tokens.js';
import type { Store } from '../../store/store.js';
import { FrameError } from './frame.js';
import type { SessionStore } from './sessions.js';

/** A refusal with a status and nothing else. Authenticated refusals are sealed too, so a bystander learns nothing from them. */
export class Refusal extends Error {
  constructor(readonly status: 400 | 401 | 403 | 410) {
    super(`refused ${status}`);
  }
}

/**
 * Opens the transport frame of every route that is not public (ARCH 6.5): finds the session, checks that the account still
 * exists and the device is not revoked, decrypts, and checks the inner method and path against the real ones. Any frame
 * error ends the session.
 */
@Injectable()
export class FrameGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(T.STORE) private readonly store: Store,
    @Inject(T.SESSIONS) private readonly sessions: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()]) === true) return true;
    const allowUnregistered = this.reflector.getAllAndOverride<boolean>(ALLOW_UNREGISTERED_DEVICE, [context.getHandler(), context.getClass()]) === true;
    const req = context.switchToHttp().getRequest<CfRequest>();

    const header = req.headers['x-cashfold-session'];
    if (typeof header !== 'string') throw new Refusal(401);
    const sessionId = fromB64url(header);
    const hexId = sessionId.toString('hex');
    const session = sessionId.length === 16 ? this.sessions.get(hexId) : undefined;
    if (session === undefined) throw new Refusal(401);

    let frame: Uint8Array;
    const viaHeader = req.headers['x-cashfold-frame'];
    if (typeof viaHeader === 'string') frame = fromB64url(viaHeader);
    else if (req.body instanceof Uint8Array) frame = req.body;
    else throw new Refusal(401);

    let plain: Buffer;
    try {
      plain = session.transport.open(frame);
    } catch (e) {
      this.sessions.end(hexId);
      if (e instanceof FrameError) throw new Refusal(401);
      throw e;
    }

    // From here the session is valid, so refusals are sealed in it (the exception filter finds the transport on the request).
    const caller = { accountId: session.accountId, deviceId: session.deviceId, transport: session.transport, device: undefined as { sigPk: Uint8Array } | undefined, sessionId };
    req.cf = { caller, inner: undefined };
    if (await this.store.accounts.isTombstoned(session.accountId)) throw new Refusal(410);
    const device = await this.store.devices.get(session.deviceId);
    if (device !== undefined && (device.accountId !== session.accountId || device.revokedAtMs !== null)) throw new Refusal(403);
    if (device === undefined && !allowUnregistered) throw new Refusal(403);
    caller.device = device === undefined ? undefined : { sigPk: device.sigPk };

    const inner = readInner(plain);
    if (inner === undefined || inner.m !== req.method || inner.p !== (req.raw.url ?? '')) throw new Refusal(400);
    req.cf.inner = inner.b;
    return true;
  }
}
