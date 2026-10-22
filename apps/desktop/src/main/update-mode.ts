import type { AboutInfo } from '@cashfold/platform';

/**
 * Whether this copy can update inside the app or must point to the release page:
 *  - the Windows installer and the AppImage can, whether or not they are signed (the project's own update signature protects them either way);
 *  - the Mac app can only when it is code-signed (macOS refuses to swap an unsigned app in place);
 *  - deb and rpm belong to the system's package manager, and an unpacked folder has no installer to run.
 */
export function decideUpdateMode(deps: { readonly platform: string; readonly packaging: string; readonly signed: boolean }): AboutInfo['updateMode'] {
  if (deps.platform === 'win32' && deps.packaging === 'nsis') return 'in-app';
  if (deps.platform === 'linux' && deps.packaging === 'appimage') return 'in-app';
  if (deps.platform === 'darwin' && deps.packaging === 'dmg' && deps.signed) return 'in-app';
  return 'manual';
}
