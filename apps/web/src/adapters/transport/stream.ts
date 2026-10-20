import type { Id } from '@cashfold/core';
import { foldRef } from '@cashfold/core';
import type { WebRelayLink } from './relay-auth';
import { websocketBase } from './relay-http';

// The Fold stream (GET /folds/{id}/stream): a WebSocket on which the service sends one byte whenever the Fold has new ops.
// The byte carries nothing, so the stream tells the network only that something changed. The first frame sent proves the
// session, exactly as a request would; it is sealed under the same counter, so the stream is opened while no other request
// is in flight, and the session is released for further requests only when the service has answered.

export interface FoldStream {
  close(): void;
}

export interface StreamOptions {
  readonly link: WebRelayLink;
  readonly fold: Id;
  /** The service said "pull now". */
  readonly onNudge: () => void;
  /** The stream ended for any reason. */
  readonly onClose: () => void;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly openTimeoutMs?: number;
}

export async function openFoldStream(o: StreamOptions): Promise<FoldStream | undefined> {
  const Impl = o.WebSocketImpl ?? WebSocket;
  const path = `/folds/${foldRef(o.fold)}/stream?session=${toB64Url(o.link.session.sessionId)}`;
  let ws: WebSocket | undefined;
  let closed = false;
  const ended = (): void => {
    if (!closed) {
      closed = true;
      o.onClose();
    }
  };

  const ready = await o.link.exclusive(
    () =>
      new Promise<boolean>((resolve) => {
        const socket = new Impl(`${websocketBase(o.link.server)}${path}`);
        ws = socket;
        socket.binaryType = 'arraybuffer';
        let settled = false;
        const settle = (ok: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(ok);
        };
        const timer = setTimeout(() => settle(false), o.openTimeoutMs ?? 10_000);
        socket.addEventListener('open', () => {
          void o.link.session.sealRequest('GET', path).then((frame) => socket.send(frame as BufferSource), () => settle(false));
        });
        socket.addEventListener('message', () => {
          if (!settled) settle(true); // the first byte answers the proof; later ones are nudges
          else o.onNudge();
        });
        socket.addEventListener('error', () => settle(false));
        socket.addEventListener('close', () => {
          settle(false);
          ended();
        });
      }),
  );
  if (!ready) {
    ws?.close();
    ended();
    return undefined;
  }
  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}

const toB64Url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
