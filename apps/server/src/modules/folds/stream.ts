import type { IncomingMessage, Server } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { fromB64url } from '../../common/crypto-util.js';
import { readInner } from '../../common/http.js';
import type { Store } from '../../store/store.js';
import type { SessionStore } from '../auth/sessions.js';

// GET /folds/{id}/stream. The client sends one authenticated frame (the same kind as any request) to prove the session and
// name the Fold. After that the server sends a single byte whenever the Fold has new ops, meaning "pull now". The byte
// carries no data, so the stream reveals only when something changed, which TLS already hides from the network.

export const PING = Buffer.from([1]);

export function attachStream(server: Server, deps: { store: Store; sessions: SessionStore; events: EventEmitter }): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const subscribers = new Map<string, Set<WebSocket>>();

  const onChanged = (foldHex: string): void => {
    for (const ws of subscribers.get(foldHex) ?? []) if (ws.readyState === ws.OPEN) ws.send(PING);
  };
  deps.events.on('changed', onChanged);

  const refuse = (socket: Duplex): void => {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(req.url ?? '', 'http://x');
    const m = /^\/folds\/([A-Za-z0-9_-]{22})\/stream$/.exec(url.pathname);
    const sessionParam = url.searchParams.get('session');
    if (m === null || sessionParam === null) return refuse(socket);
    const fold = fromB64url(m[1]!);
    const sessionId = fromB64url(sessionParam);
    if (fold.length !== 16 || sessionId.length !== 16) return refuse(socket);

    wss.handleUpgrade(req, socket, head, (ws) => {
      let subscribed: string | undefined;
      const drop = (): void => {
        if (subscribed !== undefined) subscribers.get(subscribed)?.delete(ws);
      };
      ws.on('close', drop);
      ws.on('error', drop);
      ws.once('message', (data, isBinary) => {
        void (async () => {
          try {
            const session = deps.sessions.get(sessionId.toString('hex'));
            if (session === undefined || !isBinary) return ws.close(4401);
            const plain = session.transport.open(Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]));
            const inner = readInner(plain);
            if (inner === undefined || inner.m !== 'GET' || inner.p !== `${url.pathname}${url.search}`) return ws.close(4400);
            const device = await deps.store.devices.get(session.deviceId);
            if (device === undefined || device.revokedAtMs !== null || (await deps.store.folds.roleOf(fold, session.accountId)) === undefined) return ws.close(4403);
            subscribed = fold.toString('hex');
            const set = subscribers.get(subscribed) ?? new Set<WebSocket>();
            set.add(ws);
            subscribers.set(subscribed, set);
            ws.send(PING); // "pull now": covers anything that arrived while connecting
          } catch {
            ws.close(4401);
          }
        })();
      });
    });
  };
  server.on('upgrade', onUpgrade);

  return () => {
    deps.events.off('changed', onChanged);
    server.off('upgrade', onUpgrade);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
