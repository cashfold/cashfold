import qrcode from 'qrcode-generator';
import type { Translate } from '../i18n/i18n';

// The Emergency Kit (FR-003): a printable, self-contained page with the account details and the Secret Key, an empty line
// for the password, and a QR code that adds another device. It contains no script, no external resource and no link
// that loads anything, so opening or printing it contacts nobody.

export interface KitDetails {
  readonly accountId: string;
  readonly email: string;
  /** The service address. Empty for an account kept only on this device: the kit then has no service line and no add-device link. */
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

/** The language the page is written in: the page itself is a plain file with no script, so everything is fixed when it is built. */
export interface KitLanguage {
  readonly t: Translate;
  readonly locale: string;
  readonly dir: 'ltr' | 'rtl';
}

export function buildEmergencyKitHtml(kit: KitDetails, appOrigin: string, language: KitLanguage): string {
  const e = escapeHtml;
  const { t } = language;
  const hasService = kit.server !== '';
  // Without a service there is nothing to add another device to, so no link is made at all.
  const qr = hasService ? qrSvg(qrMatrix(addDeviceUrl(appOrigin, kit)), t('kit.doc.qr.label')) : '';
  return `<!doctype html>
<html lang="${e(language.locale)}" dir="${language.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(t('kit.doc.title'))}</title>
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
<h1>${e(t('kit.doc.title'))}</h1>
<p>${e(t('kit.doc.generated', { date: kit.generatedOn }))}</p>
<dl>
  <dt>${e(t('kit.doc.accountId'))}</dt><dd>${e(kit.accountId)}</dd>
  <dt>${e(t('kit.doc.email'))}</dt><dd>${e(kit.email)}</dd>
  <dt>${e(t('kit.doc.service'))}</dt><dd>${e(hasService ? kit.server : t('kit.doc.local'))}</dd>
  <dt>${e(t('kit.doc.secretKey'))}</dt><dd class="secret">${e(kit.secretKeyText)}</dd>
  <dt>${e(t('kit.doc.password'))}</dt><dd><span class="blank">________________</span> ${e(t('kit.doc.passwordNote'))}</dd>
</dl>
<div class="warning">
  <p><strong>${e(t('kit.doc.warning.strong'))}</strong> ${e(t('kit.doc.warning.rest'))}</p>
  <p>${e(t('kit.doc.warning.lost'))}</p>
</div>
${hasService ? `<div class="qr">${qr}<p>${e(t('kit.doc.qr.text'))}</p></div>` : ''}
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
