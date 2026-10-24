// The environment for electron-builder, without credential variables that are set but empty.
//
// The desktop workflow sets every signing variable on every run and leaves it empty when nothing is signed (`${{ ... || '' }}`). electron-builder
// treats a variable that is defined as given: an empty CSC_LINK becomes the current folder ("apps/desktop not a file") and the build stops. An
// empty credential means "none", so it is removed before electron-builder sees it.

const CREDENTIAL = /^(?:CSC_|WIN_CSC_|APPLE_|AZURE_)/;

/** @param {Record<string, string | undefined>} env @returns {Record<string, string | undefined>} */
export function withoutEmptyCredentials(env) {
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => !(CREDENTIAL.test(name) && (value === undefined || value.trim() === ''))));
}
