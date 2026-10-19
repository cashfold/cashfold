import { Controller, Delete, Get, HttpCode, HttpException, Inject, Param, Post, Put } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { ALLOW_UNREGISTERED_DEVICE, Auth, Payload, type Caller } from '../../common/http.js';
import { fromB64url } from '../../common/crypto-util.js';
import { T } from '../../common/tokens.js';
import { DeviceBody, DeviceLabelBody, parseValue } from '../../common/wire.js';
import type { Clock } from '../../common/rate-limit.js';
import type { Store } from '../../store/store.js';
import type { SessionStore } from '../auth/sessions.js';

const fail = (status: number, code: string): never => {
  throw new HttpException({ code }, status);
};

@Controller('devices')
export class DevicesController {
  constructor(
    @Inject(T.STORE) private readonly store: Store,
    @Inject(T.SESSIONS) private readonly sessions: SessionStore,
    @Inject(T.CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  async list(@Auth() caller: Caller): Promise<unknown> {
    const devices = await this.store.devices.list(caller.accountId);
    return devices.map((d) => ({
      dev_id: d.devId, sig_pk: d.sigPk, ...(d.labelCt !== null && { label_ct: d.labelCt }), created_at: BigInt(d.createdAtMs), ...(d.revokedAtMs !== null && { revoked_at: BigInt(d.revokedAtMs) }),
    }));
  }

  /** A new device registers its own signing key. It can register only itself (the id it signed in with). */
  @SetMetadata(ALLOW_UNREGISTERED_DEVICE, true) @Post() @HttpCode(201)
  async register(@Auth() caller: Caller, @Payload() inner: unknown): Promise<void> {
    const b = parseValue(inner, DeviceBody);
    if (!Buffer.from(b.dev_id).equals(Buffer.from(caller.deviceId))) fail(403, 'wrong_device');
    const r = await this.store.devices.add({ devId: b.dev_id, accountId: caller.accountId, sigPk: b.sig_pk, labelCt: b.label_ct ?? null, createdAtMs: this.clock.now(), revokedAtMs: null });
    if (r === 'exists') fail(409, 'exists');
  }

  /** Renames a device. The label is ciphertext the relay cannot read; any device of the account may rename any other. */
  @Put(':devId') @HttpCode(204)
  async rename(@Auth() caller: Caller, @Param('devId') devId: string, @Payload() inner: unknown): Promise<void> {
    const id = fromB64url(devId);
    if (id.length !== 16) fail(400, 'bad_request');
    const b = parseValue(inner, DeviceLabelBody);
    if (!(await this.store.devices.setLabel(caller.accountId, id, b.label_ct))) fail(404, 'not_found');
  }

  /** Revokes a device: its sessions end now, and the guard refuses it from here on (AUTH-7). */
  @Delete(':devId') @HttpCode(204)
  async revoke(@Auth() caller: Caller, @Param('devId') devId: string): Promise<void> {
    const id = fromB64url(devId);
    if (id.length !== 16) fail(400, 'bad_request');
    if (!(await this.store.devices.revoke(caller.accountId, id, this.clock.now()))) fail(404, 'not_found');
    this.sessions.endAll(caller.accountId, id);
  }
}
