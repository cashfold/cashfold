import type { ServerTransport } from './frame.js';
import type { Exchange } from './srp-server.js';
import type { Clock } from '../../common/rate-limit.js';

// Sign-in state held in memory, by session id. A handshake lives 60 seconds; an authenticated session is bounded by
// the transport's own 30-minute idle and 24-hour absolute limits (contracts/auth-srp.md).

export const HANDSHAKE_MS = 60_000;

export interface Handshake {
  readonly stage: 'salt_sent' | 'b_sent';
  readonly expiresAt: number;
  /** The real account, or the stand-in used for an unknown address. */
  readonly accountId: string;
  readonly real: boolean;
  readonly authSalt: Uint8Array;
  readonly deviceId: Uint8Array;
  readonly subject: string;
  readonly ip: string;
  readonly verifier: Uint8Array;
  exchange?: Exchange;
}

export interface Authenticated {
  readonly accountId: string;
  readonly deviceId: Uint8Array;
  readonly transport: ServerTransport;
  /** When the exchange completed, and its client proof: what a "fresh proof" for account deletion is checked against. */
  readonly authenticatedAt: number;
  readonly m1: Uint8Array;
}

export interface SessionStore {
  startHandshake(id: string, h: Handshake): void;
  handshake(id: string): Handshake | undefined;
  /** Removes and returns the handshake: each is used once. */
  takeHandshake(id: string): Handshake | undefined;
  authenticate(id: string, s: Authenticated): void;
  get(id: string): Authenticated | undefined;
  end(id: string): void;
  /** Ends every session of an account (password change, deletion, revoked device with `deviceId`). */
  endAll(accountId: string, deviceId?: Uint8Array, except?: string): void;
}

export function createSessionStore(clock: Clock): SessionStore {
  const pending = new Map<string, Handshake>();
  const authed = new Map<string, Authenticated>();

  const sweep = (): void => {
    const now = clock.now();
    for (const [k, h] of pending) if (h.expiresAt <= now) pending.delete(k);
    for (const [k, s] of authed) if (s.transport.isExpired()) {
      s.transport.close();
      authed.delete(k);
    }
  };

  return {
    startHandshake(id, h) {
      sweep();
      pending.set(id, h);
    },
    handshake(id) {
      const h = pending.get(id);
      if (h !== undefined && h.expiresAt <= clock.now()) {
        pending.delete(id);
        return undefined;
      }
      return h;
    },
    takeHandshake(id) {
      const h = this.handshake(id);
      pending.delete(id);
      return h;
    },
    authenticate(id, s) {
      authed.set(id, s);
    },
    get(id) {
      const s = authed.get(id);
      if (s === undefined) return undefined;
      if (s.transport.isExpired()) {
        s.transport.close();
        authed.delete(id);
        return undefined;
      }
      return s;
    },
    end(id) {
      authed.get(id)?.transport.close();
      authed.delete(id);
      pending.delete(id);
    },
    endAll(accountId, deviceId, except) {
      for (const [k, s] of authed) {
        if (s.accountId !== accountId || k === except) continue;
        if (deviceId !== undefined && !Buffer.from(s.deviceId).equals(Buffer.from(deviceId))) continue;
        s.transport.close();
        authed.delete(k);
      }
    },
  };
}
