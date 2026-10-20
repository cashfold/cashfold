import type { PublishedRates, RatesSourcePort } from '@cashfold/core';
import { createFetchSend, type FetchLike } from './relay-http';

// GET /rates on the user's own service: the same table for everyone, no account, no cookie, no query. The document carries
// every rate as text, so no value passes through a floating-point number on its way to a stored rate.

export function createWebRatesSource(server: string, deps: { fetchImpl?: FetchLike } = {}): RatesSourcePort {
  const send = createFetchSend(server, deps.fetchImpl);
  return {
    async fetch() {
      let res;
      try {
        res = await send({ method: 'GET', path: '/rates', headers: { accept: 'application/json' } });
      } catch {
        return { ok: false, reason: 'offline' };
      }
      if (res.status === 404) return { ok: false, reason: 'not_published' };
      if (res.status !== 200) return { ok: false, reason: res.status >= 500 ? 'offline' : 'invalid' };
      try {
        const doc = JSON.parse(new TextDecoder().decode(res.body)) as Record<string, unknown>;
        const rates = doc['rates'];
        if (typeof doc['base'] !== 'string' || typeof doc['as_of'] !== 'string' || typeof rates !== 'object' || rates === null) return { ok: false, reason: 'invalid' };
        const table: Record<string, string> = {};
        for (const [k, v] of Object.entries(rates)) if (typeof v === 'string') table[k] = v;
        const out: PublishedRates = { base: doc['base'], asOf: doc['as_of'], source: typeof doc['source'] === 'string' ? doc['source'] : 'service', rates: table };
        return { ok: true, table: out };
      } catch {
        return { ok: false, reason: 'invalid' };
      }
    },
  };
}
