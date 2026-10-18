import qrcode from 'qrcode-generator';

// The Emergency Kit (FR-003): a printable, self-contained page with the account details and the Secret Key, an empty line
// for the password, and a QR code that adds another device. It contains no script, no external resource and no link
// that loads anything, so opening or printing it contacts nobody.

export interface KitDetails {
  readonly accountId: string;
  readonly email: string;
  readonly server: string;
  readonly secretKeyText: string;
  /** ISO date shown on the page. */
  readonly generatedOn: string;
}

/**
 * `https://<app>/add#email=...&server=...&key=C1-...`. Everything is in the fragment, which browsers do not send to any server.
 */
export function addDeviceUrl(appOrigin: string, kit: Pick<KitDetails, 'email' | 'server' | 'secretKeyText'>): string {
  const fragment = new URLSearchParams({ email: kit.email, server: kit.server, key: kit.secretKeyText });
  return `${appOrigin.replace(/\/$/, '')}/add#${fragment.toString()}`;
}

export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

function qrSvg(matrix: boolean[][], label: string): string {
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const path = matrix.flatMap((row, r) => row.flatMap((dark, c) => (dark ? [`M${c + quiet} ${r + quiet}h1v1h-1z`] : []))).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="220" height="220" role="img" aria-label="${escapeHtml(label)}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function buildEmergencyKitHtml(kit: KitDetails, appOrigin: string): string {
  const e = escapeHtml;
  const qr = qrSvg(qrMatrix(addDeviceUrl(appOrigin, kit)), 'QR code that adds a device to this account');
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cashfold Emergency Kit</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; color: #111; background: #fff; margin: 2rem auto; max-width: 42rem; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1.5rem; margin: 1.5rem 0; }
  dt { font-weight: 600; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .secret { font: 600 1.25rem/1.4 ui-monospace, monospace; letter-spacing: .04em; }
  .blank { border-bottom: 1px solid #111; min-width: 16rem; display: inline-block; }
  .warning { border: 2px solid #111; padding: .75rem 1rem; margin: 1.5rem 0; }
  .qr { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; }
  @media print { body { margin: 0; } .warning { break-inside: avoid; } }
</style>
</head>
<body>
<h1>Cashfold Emergency Kit</h1>
<p>Generated on ${e(kit.generatedOn)}. Keep this page somewhere safe.</p>
<dl>
  <dt>Account ID</dt><dd>${e(kit.accountId)}</dd>
  <dt>Email</dt><dd>${e(kit.email)}</dd>
  <dt>Service</dt><dd>${e(kit.server)}</dd>
  <dt>Secret Key</dt><dd class="secret">${e(kit.secretKeyText)}</dd>
  <dt>Master password</dt><dd><span class="blank">________________</span> (write it here only if you keep this page locked away)</dd>
</dl>
<div class="warning">
  <p><strong>Do not store your password with this page.</strong> You need both the password and the Secret Key to sign in on a new device. Either one alone gets nobody into your data.</p>
  <p>Lost credentials cannot be recovered by anyone, including Cashfold, unless you set up a Recovery Key.</p>
</div>
<div class="qr">${qr}<p>Scan this code on a new device to start adding it. It contains your Secret Key, so treat it like the Secret Key itself.</p></div>
</body>
</html>
`;
}

type ClipboardLike = { writeText(text: string): Promise<void> };
let latestCopy = 0;

/**
 * Copies on an explicit user action, then overwrites the clipboard after `delayMs` unless something newer was copied here.
 * Returns false (never throws) when the clipboard is unavailable or denied.
 */
export async function copyWithAutoClear(text: string, delayMs: number, clipboard: ClipboardLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard): Promise<boolean> {
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
  } catch {
    return false;
  }
  const mine = ++latestCopy;
  setTimeout(() => {
    if (mine === latestCopy) void clipboard.writeText('').catch(() => undefined);
  }, delayMs);
  return true;
}
