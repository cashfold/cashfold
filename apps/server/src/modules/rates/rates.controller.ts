import { Controller, Get, HttpException, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/http.js';
import { T } from '../../common/tokens.js';
import type { RatesService } from './rates.service.js';

@Controller('rates')
export class RatesController {
  constructor(@Inject(T.RATES) private readonly rates: RatesService) {}

  /** The same table for everyone, with no account or query: it reveals nothing about the caller (FR-103). */
  @Public() @Get()
  async table(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const doc = await this.rates.document();
    if (doc === undefined) throw new HttpException({ code: 'not_found' }, 404);
    reply.type('application/json').header('cache-control', 'public, max-age=300');
    return doc;
  }
}
