import type { Store, RateTableRow } from '../../store/store.js';

// The one shared exchange-rate table (FR-103). The upstream is whatever the operator configured; the relay never contacts a
// third party for any other reason, and nothing about a caller reaches the upstream. Rates are read as decimal text: the
// body is never parsed as JSON numbers, so no value passes through a float.

const CODE = /^[A-Z]{3,5}$/;
const DECIMAL = /^[0-9]+(\.[0-9]{1,18})?$/;

/** Pulls `"EUR": 0.9137` or `"EUR": "0.9137"` pairs out of the `rates` object of a JSON document, as text. */
export function parseRatesText(body: string): Record<string, string> | undefined {
  const start = body.search(/"rates"\s*:\s*\{/);
  if (start < 0) return undefined;
  const open = body.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return undefined;
  const out: Record<string, string> = {};
  for (const m of body.slice(open + 1, end).matchAll(/"([A-Za-z]+)"\s*:\s*(?:"([^"]*)"|(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?))/g)) {
    const code = m[1]!.toUpperCase();
    const value = m[2] ?? m[3]!;
    if (CODE.test(code) && DECIMAL.test(value) && /[1-9]/.test(value)) out[code] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createRatesService(deps: { store: Store; config: { kind: 'disabled' } | { kind: 'upstream'; url: string; everyHours: number }; fetchText?: (url: string) => Promise<string>; now: () => number }) {
  const { store, config } = deps;
  const fetchText = deps.fetchText ?? (async (url: string) => (await fetch(url, { headers: { accept: 'application/json' } })).text());

  return {
    enabled: config.kind === 'upstream',

    /** The published table as JSON text, or undefined when publication is off or nothing was fetched yet. */
    async document(): Promise<string | undefined> {
      if (config.kind === 'disabled') return undefined;
      const t = await store.rates.latest();
      if (t === undefined) return undefined;
      const rates = Object.entries(t.rates).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',');
      return `{"base":${JSON.stringify(t.base)},"as_of":${JSON.stringify(new Date(t.asOfMs).toISOString())},"source":${JSON.stringify(t.source)},"rates":{${rates}}}`;
    },

    /** One refresh from the upstream. A bad or empty answer changes nothing. */
    async refresh(): Promise<boolean> {
      if (config.kind === 'disabled') return false;
      let body: string;
      try {
        body = await fetchText(config.url);
      } catch {
        return false;
      }
      const rates = parseRatesText(body);
      if (rates === undefined) return false;
      const row: RateTableRow = { asOfMs: deps.now(), base: 'USD', source: new URL(config.url).host, rates };
      await store.rates.put(row);
      return true;
    },
  };
}

export type RatesService = ReturnType<typeof createRatesService>;
