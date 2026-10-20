import { createParamDecorator, SetMetadata, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { decode, encode } from '@cashfold/protocol/cbor';
import { map, type Observable } from 'rxjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerTransport } from '../modules/auth/frame.js';

// How requests and responses cross the wire. Before sign-in, bodies are plain CBOR. After it, every request carries an
// authenticated frame, and so does every response: the inner request names the method and path, which the guard checks
// against the real ones, so a captured frame cannot be pointed at a different route.

export const PUBLIC = 'cashfold:public';
export const ALLOW_UNREGISTERED_DEVICE = 'cashfold:allow-unregistered-device';
/** Routes reachable without a session: sign-in, registration, e-mail confirmation, published rates. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Routes a device may call before its signing key is registered (it is registering it). */
export const AllowUnregisteredDevice = () => SetMetadata(ALLOW_UNREGISTERED_DEVICE, true);

export interface Caller {
  readonly accountId: string;
  readonly deviceId: Uint8Array;
  readonly transport: ServerTransport;
  /** The registered device, or undefined for a device that is still enrolling. */
  readonly device: { readonly sigPk: Uint8Array } | undefined;
  readonly sessionId: Uint8Array;
}

export interface HttpCtx {
  caller?: Caller;
  /** Decoded inner body of an authenticated request. */
  inner?: unknown;
}

export type CfRequest = FastifyRequest & { cf?: HttpCtx };

/** The authenticated caller; throws if the route was not behind the frame guard. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): Caller => {
  const c = ctx.switchToHttp().getRequest<CfRequest>().cf?.caller;
  if (c === undefined) throw new Error('route is not authenticated');
  return c;
});

/** The body: the decoded inner body for authenticated routes, the raw CBOR bytes for public ones. */
export const Payload = createParamDecorator((_: unknown, ctx: ExecutionContext): unknown => {
  const req = ctx.switchToHttp().getRequest<CfRequest>();
  return req.cf?.caller !== undefined ? req.cf.inner : req.body;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<FastifyRequest>().ip);

/** Wraps a handler's value in CBOR, and in a sealed frame for authenticated routes. */
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<CfRequest>();
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(map((value) => {
      if (typeof value === 'string' && req.cf?.caller === undefined) return value; // a public JSON document (the rate table)
      reply.type('application/cbor');
      // A 204 cannot carry a body, so a sealed answer travels as 200 and the real status is inside the frame.
      const sealedStatus = reply.statusCode;
      if (req.cf?.caller !== undefined && sealedStatus === 204) void reply.status(200);
      const inner = value === undefined || value === null ? null : value;
      return req.cf?.caller === undefined ? (value === undefined ? Buffer.alloc(0) : Buffer.from(encode(inner as never))) : sealResponse(req.cf.caller.transport, sealedStatus, inner);
    }));
  }
}

export function sealResponse(transport: ServerTransport, status: number, body: unknown): Buffer {
  return transport.seal(encode({ s: BigInt(status), b: body } as never));
}

export interface InnerRequest {
  readonly m: string;
  readonly p: string;
  readonly b: unknown;
}

export function readInner(plain: Uint8Array): InnerRequest | undefined {
  try {
    const v = decode(plain);
    if (!(v instanceof Map)) return undefined;
    const [m, p, b] = [v.get('m'), v.get('p'), v.get('b')];
    return typeof m === 'string' && typeof p === 'string' ? { m, p, b: b === undefined ? null : b } : undefined;
  } catch {
    return undefined;
  }
}
