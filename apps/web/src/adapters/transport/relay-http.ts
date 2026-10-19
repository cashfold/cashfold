import type { HttpRequest, HttpResponse, Send } from '@cashfold/crypto';

// Moves the relay protocol's bytes over fetch. Every request is CBOR in a body or a header; nothing identifying goes in a
// cookie (credentials are omitted), and nothing is cached.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createFetchSend(server: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)): Send {
  const base = server.replace(/\/+$/, '');
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const res = await fetchImpl(`${base}${req.path}`, {
      method: req.method,
      headers: req.headers,
      ...(req.body !== undefined && { body: req.body as BodyInit }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) };
  };
}

/** `https://host` to `wss://host` for the Fold stream. */
export const websocketBase = (server: string): string => server.replace(/\/+$/, '').replace(/^http/, 'ws');
