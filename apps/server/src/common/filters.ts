import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { encode } from '@cashfold/protocol/cbor';
import type { FastifyReply } from 'fastify';
import { AuthError } from '../modules/auth/auth.service.js';
import { Refusal } from '../modules/auth/frame.guard.js';
import { BadRequest } from './wire.js';
import { sealResponse, type CfRequest } from './http.js';

/** Where a failure is turned into an answer. The answer is a status and a short code: never a message, never a value. */
@Catch()
export class RelayExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const req = http.getRequest<CfRequest>();

    let status = 500;
    let code = 'internal';
    let retryAfterSec: number | undefined;
    if (error instanceof Refusal) {
      status = error.status;
      code = error.status === 410 ? 'gone' : 'refused';
    } else if (error instanceof AuthError) {
      status = error.kind === 'rate_limited' ? 429 : error.kind === 'device_revoked' ? 403 : 401;
      code = error.kind === 'rate_limited' ? 'rate_limited' : error.kind === 'device_revoked' ? 'device_revoked' : 'rejected';
      retryAfterSec = error.retryAfterSec;
    } else if (error instanceof BadRequest) {
      status = 400;
      code = 'bad_request';
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = typeof (error.getResponse() as { code?: unknown })?.code === 'string' ? (error.getResponse() as { code: string }).code : 'error';
    }
    if (status === 500) process.stderr.write(`unhandled ${(error as Error)?.name ?? 'error'}\n`); // the type only: never the message

    if (retryAfterSec !== undefined) reply.header('Retry-After', String(retryAfterSec));
    reply.status(status).type('application/cbor');
    const body = { error: code };
    const transport = req.cf?.caller?.transport;
    if (transport !== undefined && !transport.closed) {
      try {
        void reply.send(sealResponse(transport, status, body));
        return;
      } catch {
        // fall through to an unsealed answer
      }
    }
    void reply.send(Buffer.from(encode(body as never)));
  }
}
