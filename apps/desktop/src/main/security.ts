import type { DownloadItem, Session, WebContents } from 'electron';
import { APP_ORIGIN, SOURCE_REPO_URL } from './identity';

// What the page is allowed to do, kept as small pure functions (tested in security.test.ts) with the Electron wiring injected, so the policy
// can be read and tested without a running Electron. Everything not listed here is refused (R-D-11).

const REPO = new URL(SOURCE_REPO_URL);

/** Links the app may open in the user's browser: https, no credentials, no port, on the project's own repository. */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false;
  if (url.host !== REPO.host) return false;
  // The parser resolves dot segments and %2e, so a traversal out of the repository shows up in pathname.
  const path = url.pathname;
  return path === REPO.pathname || path.startsWith(`${REPO.pathname}/`);
}

const GRANTED = new Set(['persistent-storage', 'publickey-credentials-get', 'notifications']);

/** Persistent storage (so the browser engine keeps the data), platform authenticators and notifications (the reminders), for the app origin only. */
export function decidePermission(permission: string, origin: string): boolean {
  // The engine reports the requesting origin with a trailing slash in some checks ("app://cashfold/") and without in others.
  return origin.replace(/\/$/, '') === APP_ORIGIN && GRANTED.has(permission);
}

export type DownloadDecision = { readonly allow: true; readonly filename: string } | { readonly allow: false };

/** Files the app itself offers are all built in the page from its own data and saved as `blob:` URLs of the app origin. */
const OWN_BLOB = `blob:${APP_ORIGIN}/`;
const MAX_NAME = 200;
const MAX_EXTENSION = 16;

/**
 * A download is allowed only when the app's own page made it (an Emergency Kit, a backup, a CSV or an attachment, all `blob:` URLs of the
 * app origin), and it always goes through the native save dialog, so nothing is written without the user choosing where. The suggested
 * name is reduced to a plain file name: no folders, no control characters, no leading dots.
 */
export function downloadPolicy(suggestedName: string, url: string): DownloadDecision {
  if (!url.startsWith(OWN_BLOB)) return { allow: false };
  const base = (suggestedName.split(/[\\/]/).at(-1) ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim();
  if (base === '' ) return { allow: true, filename: 'download' };
  if (base.length <= MAX_NAME) return { allow: true, filename: base };
  // Too long: shorten the stem and keep a short extension.
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 && base.length - dot <= MAX_EXTENSION ? base.slice(dot) : '';
  return { allow: true, filename: `${base.slice(0, MAX_NAME - extension.length)}${extension}` };
}

export interface SecurityDeps {
  readonly session: Session;
  readonly openExternal: (url: string) => Promise<void>;
  /** Shows the native save dialog for a download that the policy allowed. */
  readonly saveDialogOptions: (filename: string) => Electron.SaveDialogOptions;
  /** Told where a download was saved, so the next save dialog can open in the same folder. */
  readonly onSaved?: (savedPath: string) => void;
  readonly log: { warn(event: string, fields?: Record<string, unknown>): void; debug?(event: string, fields?: Record<string, unknown>): void };
}

/** Locks down a window's web contents: no navigation away, no new windows, no webviews. */
export function lockDownContents(contents: WebContents, deps: Pick<SecurityDeps, 'openExternal' | 'log'>, extraOrigins: readonly string[] = []): void {
  const own = new Set([APP_ORIGIN, ...extraOrigins]);
  contents.on('will-navigate', (event, url) => {
    if (own.has(safeOrigin(url))) return;
    event.preventDefault();
    // A file dropped on a part of the page that does not take files would open it in the window: it is ignored, and it is not worth a warning.
    if (url.startsWith('file:')) deps.log.debug?.('security.file-drop-ignored');
    else if (isAllowedExternalUrl(url)) void deps.openExternal(url);
    else deps.log.warn('security.navigation-blocked');
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void deps.openExternal(url);
    else deps.log.warn('security.window-open-blocked');
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    deps.log.warn('security.webview-blocked');
  });
}

/** Session-wide policy: permissions and downloads. */
export function installSessionPolicy(deps: SecurityDeps): void {
  const { session } = deps;
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(decidePermission(permission, details.requestingUrl === '' ? '' : safeOrigin(details.requestingUrl)));
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => decidePermission(permission, requestingOrigin));
  session.on('will-download', (event: { preventDefault: () => void }, item: DownloadItem) => {
    const decision = downloadPolicy(item.getFilename(), item.getURLChain()[0] ?? item.getURL());
    if (!decision.allow) {
      event.preventDefault();
      deps.log.warn('security.download-blocked');
      return;
    }
    item.setSaveDialogOptions(deps.saveDialogOptions(decision.filename));
    // A save the person cancels is not an error: the page just gets no file.
    item.once('done', (_event, state) => {
      if (state === 'completed') deps.onSaved?.(item.getSavePath());
    });
  });
}

function safeOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}
