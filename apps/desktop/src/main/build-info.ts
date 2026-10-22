import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BuildInfo {
  /** The commit the web export was built from. */
  readonly commit?: string;
  readonly webDigest?: string;
}

/** What scripts/build.mjs recorded next to the bundle. Missing or unreadable (running from source): nothing is known. */
export function readBuildInfo(appPath: string, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): BuildInfo {
  try {
    const parsed = JSON.parse(read(join(appPath, 'dist', 'build-info.json'))) as Record<string, unknown>;
    return {
      ...(typeof parsed['commit'] === 'string' && parsed['commit'] !== '' ? { commit: parsed['commit'] } : {}),
      ...(typeof parsed['webDigest'] === 'string' ? { webDigest: parsed['webDigest'] } : {}),
    };
  } catch {
    return {};
  }
}
