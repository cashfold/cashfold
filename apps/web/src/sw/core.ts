// Pure logic of the offline service worker, kept free of worker globals so it can be unit tested.

export interface ManifestFile {
  readonly url: string;
  readonly sha256: string;
}

export interface Manifest {
  /** Changes whenever any precached byte changes. */
  readonly version: string;
  readonly files: readonly ManifestFile[];
}

export interface PutCache {
  put(url: string, response: Response): Promise<void>;
}

export const CACHE_PREFIX = 'cashfold-';
export const cacheName = (m: Pick<Manifest, 'version'>): string => `${CACHE_PREFIX}${m.version}`;

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads every file in the manifest, checks each against its published SHA-256, and only then stores them.
 * Any failure rejects with nothing stored, so a new version never activates half-cached.
 */
export async function precache(manifest: Manifest, cache: PutCache, fetchFile: (url: string) => Promise<Response>): Promise<void> {
  const verified: { url: string; body: ArrayBuffer; type: string }[] = [];
  for (const file of manifest.files) {
    const res = await fetchFile(file.url);
    if (!res.ok) throw new Error(`precache failed for ${file.url}: HTTP ${res.status}`);
    const body = await res.arrayBuffer();
    if ((await sha256Hex(body)) !== file.sha256) throw new Error(`precache hash mismatch for ${file.url}`);
    verified.push({ url: file.url, body, type: res.headers.get('content-type') ?? '' });
  }
  for (const v of verified) await cache.put(v.url, new Response(v.body, v.type ? { headers: { 'content-type': v.type } } : {}));
}

/** The precached file that answers this request, or undefined to let it go to the network untouched. */
export function lookupKey(manifest: Manifest, url: URL, isNavigation: boolean): string | undefined {
  const known = new Set(manifest.files.map((f) => f.url));
  if (known.has(url.pathname)) return url.pathname;
  if (!isNavigation) return undefined;
  const dir = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  if (known.has(`${dir}index.html`)) return `${dir}index.html`;
  return known.has('/404.html') ? '/404.html' : undefined;
}

export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== current);
}
