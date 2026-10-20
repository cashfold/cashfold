import { randomBytes } from 'node:crypto';
import { encode } from '@cashfold/protocol/cbor';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BadRequest, HelloBody, parseBody, ProofABody, ProofM1Body } from '../../common/wire.js';
import { createServerTransport, FrameError } from './frame.js';
import { N, N_BYTES, pad } from './group.js';
import { createSrpServer } from './srp-server.js';

// Fuzzing what the service parses before anyone is signed in (T191): the SRP messages, the request bodies of the handshake, and the
// sealed frames. Whatever arrives, the answer must be the same refusal, and nothing may throw anything else.

const srp = createSrpServer();
const v = srp.verifierFrom(randomBytes(32));

describe('SRP server input', () => {
  it('answers any A and any verifier with a refusal or an exchange, never an exception', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 600 }), fc.uint8Array({ maxLength: 600 }), (A, verifier) => {
      const exchange = srp.begin({ v: verifier, A });
      if (exchange !== undefined) expect(exchange.B).toHaveLength(N_BYTES);
    }), { numRuns: 500 });
  });

  it('refuses A that is zero modulo N in every form it can take', () => {
    for (const A of [0n, N, 2n * N]) if (A < 1n << 4096n) expect(srp.begin({ v, A: pad(A) })).toBeUndefined();
    expect(srp.begin({ v, A: new Uint8Array(N_BYTES) })).toBeUndefined();
    expect(srp.begin({ v: new Uint8Array(N_BYTES), A: pad(5n) })).toBeUndefined();
  });

  it('answers any proof with a refusal; a guessed one never verifies', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 80 }), fc.string({ maxLength: 40 }), fc.uint8Array({ maxLength: 40 }), (M1, accountId, salt) => {
      const e = srp.begin({ v, A: randomBytes(N_BYTES) });
      if (e === undefined) return;
      expect(e.finish({ accountId, authSalt: salt, M1 })).toEqual({ ok: false });
      expect(e.finish({ accountId, authSalt: salt, M1 })).toEqual({ ok: false }); // and it is single use
    }), { numRuns: 300 });
  });
});

describe('handshake request bodies', () => {
  it('refuse arbitrary bytes and arbitrary values with one error', () => {
    for (const schema of [HelloBody, ProofABody, ProofM1Body]) {
      fc.assert(fc.property(fc.uint8Array({ maxLength: 700 }), (b) => {
        try {
          parseBody(b, schema);
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequest);
        }
      }), { numRuns: 500 });
      fc.assert(fc.property(fc.anything({ maxDepth: 3 }), (value) => {
        let encoded: Uint8Array;
        try {
          encoded = encode(value as never);
        } catch {
          return;
        }
        try {
          parseBody(encoded, schema);
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequest);
        }
      }), { numRuns: 500 });
    }
  });

  it('accept only a well-formed message', () => {
    const device = randomBytes(16);
    expect(parseBody(encode({ email: 'a@b.cc', device_id: device } as never), HelloBody).email).toBe('a@b.cc');
    expect(() => parseBody(encode({ email: 'not an address', device_id: device } as never), HelloBody)).toThrow(BadRequest);
    expect(() => parseBody(encode({ email: 'a@b.cc', device_id: randomBytes(15) } as never), HelloBody)).toThrow(BadRequest);
    expect(() => parseBody(encode({ session_id: randomBytes(16), A: randomBytes(511) } as never), ProofABody)).toThrow(BadRequest);
    expect(() => parseBody(encode({ session_id: randomBytes(16), M1: randomBytes(33) } as never), ProofM1Body)).toThrow(BadRequest);
  });
});

describe('sealed frames', () => {
  const transport = () => createServerTransport({ sessionId: Buffer.alloc(16, 7), sessionKey: Buffer.alloc(32, 1), transcript: Buffer.alloc(32, 2) });

  it('refuse any bytes with a frame error and nothing else', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 400 }), (b) => {
      try {
        transport().open(b);
        throw new Error('opened a frame nobody sealed');
      } catch (e) {
        expect(e).toBeInstanceOf(FrameError);
      }
    }), { numRuns: 1000 });
  });
});
