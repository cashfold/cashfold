import { createServer, type Server } from 'node:http';

// A small server in front of the app under test that can pretend a new version was deployed (spec 009): it serves everything as it is, except that
// the baked version of the worker (/sw.js) and of the precache manifest can be changed, and one file can be made to fail or to hang. A page cannot do this
// itself: the browser fetches the worker script for an update outside what Playwright's `route` sees.

export interface VersionedServer {
  readonly url: string;
  /** The version the app was built with, read from the real server. */
  original(): Promise<string>;
  /** From now on serve this version (null: the real one). */
  setVersion(version: string | null): void;
  /** Answer this path with a 500 (null: stop). */
  failPath(path: string | null): void;
  /** Never answer this path until `release()` (null: stop). */
  holdPath(path: string | null): void;
  release(): void;
  close(): Promise<void>;
}

export async function startVersionedServer(target: string, port: number): Promise<VersionedServer> {
  let version: string | null = null;
  let failing: string | null = null;
  let holding: string | null = null;
  let releaseHeld: (() => void) | undefined;
  const held = new Promise<void>((resolve) => (releaseHeld = resolve));
  let original: string | undefined;

  const read = async (path: string): Promise<Response> => fetch(`${target}${path}`, { cache: 'no-store' });
  const originalVersion = async (): Promise<string> => (original ??= ((await (await read('/precache-manifest.json')).json()) as { version: string }).version);

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0]!;
      if (failing !== null && path === failing) {
        res.writeHead(500).end('fail');
        return;
      }
      if (holding !== null && path === holding) await held;
      const upstream = await read(req.url ?? '/');
      const headers: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) headers[key] = value;
      });
      if (version !== null && (path === '/sw.js' || path === '/precache-manifest.json')) {
        const body = (await upstream.text()).split(await originalVersion()).join(version);
        res.writeHead(upstream.status, { ...headers, 'cache-control': 'no-store' }).end(body);
        return;
      }
      res.writeHead(upstream.status, headers).end(Buffer.from(await upstream.arrayBuffer()));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    url: `http://localhost:${port}`,
    original: originalVersion,
    setVersion: (next) => void (version = next),
    failPath: (path) => void (failing = path),
    holdPath: (path) => void (holding = path),
    release: () => releaseHeld?.(),
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
