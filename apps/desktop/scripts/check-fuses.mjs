// Reads the fuses of a packaged app and fails unless they are the release values (research R-D-09). The end-to-end tests run a test build with
// the Node-inspector fuse on (Playwright needs it), so this is the check on the build that is actually shipped.
//
//   node scripts/check-fuses.mjs [path to the app executable]    (default: the unpacked app electron-builder left in release/)
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = join(desktop, 'release');

function find() {
  const candidates = [
    join(release, 'mac-arm64/Cashfold.app/Contents/MacOS/Cashfold'),
    join(release, 'mac/Cashfold.app/Contents/MacOS/Cashfold'),
    join(release, 'win-unpacked/Cashfold.exe'),
    ...(existsSync(join(release, 'linux-unpacked')) ? readdirSync(join(release, 'linux-unpacked')).filter((f) => f.toLowerCase() === 'cashfold').map((f) => join(release, 'linux-unpacked', f)) : []),
  ];
  return candidates.filter(existsSync);
}

const targets = process.argv[2] ? [process.argv[2]] : find();
if (targets.length === 0) {
  console.error('check-fuses: no unpacked app found in release/ (build one with `package`, without --dir only the installers are kept)');
  process.exit(1);
}

const expected = {
  RunAsNode: [FuseV1Options.RunAsNode, FuseState.DISABLE],
  EnableNodeOptionsEnvironmentVariable: [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  EnableNodeCliInspectArguments: [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  EnableEmbeddedAsarIntegrityValidation: [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  OnlyLoadAppFromAsar: [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  GrantFileProtocolExtraPrivileges: [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
};

let failed = false;
for (const target of targets) {
  const wire = await getCurrentFuseWire(target);
  for (const [name, [option, state]] of Object.entries(expected)) {
    if (wire[option] !== state) {
      console.error(`${target}: fuse ${name} is ${wire[option] === FuseState.ENABLE ? 'enabled' : 'disabled'}, expected ${state === FuseState.ENABLE ? 'enabled' : 'disabled'}`);
      failed = true;
    }
  }
  if (!failed) console.log(`${target}: fuses are the release values`);
}
process.exit(failed ? 1 : 0);
