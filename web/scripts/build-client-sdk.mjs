// Build the vendored livekit-client fork (vendor/client-sdk-js) into its dist/,
// which the app consumes as a workspace package. Runs on predev/prebuild.
//
// The fork's own `schema.ts` (the data-track schema metadata this app needs)
// calls Object.fromEntries, but the SDK's tsconfigs predate that lib entry, so
// rollup's typechecker rejects it. Patch the lib in for the build and restore
// afterwards: those files belong to the submodule and must stay clean in git.
//
// `downlevel-dts` (the fork's fourth build step) is skipped: it only feeds
// `typesVersions` for TypeScript < 4.8, and this app is on 5.x.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sdk = fileURLToPath(new URL('../vendor/client-sdk-js/', import.meta.url));

const originals = new Map();
for (const name of [
  'tsconfig.json',
  'src/e2ee/worker/tsconfig.json',
  'src/frameMetadata/worker/tsconfig.json',
]) {
  const path = sdk + name;
  const source = readFileSync(path, 'utf8');
  const patched = source.replace('"ES2018.Promise",', '"ES2018.Promise",\n      "ES2019.Object",');
  if (patched === source) throw new Error(`Could not patch ${name} for the client SDK build`);
  originals.set(path, source);
  writeFileSync(path, patched);
}

try {
  for (const config of [
    'rollup.config.js',
    'rollup.config.worker.js',
    'rollup.config.fm-worker.js',
  ]) {
    execFileSync(`${sdk}node_modules/.bin/rollup`, ['--config', config, '--bundleConfigAsCjs'], {
      cwd: sdk,
      stdio: 'inherit',
    });
  }
} finally {
  for (const [path, source] of originals) writeFileSync(path, source);
}
