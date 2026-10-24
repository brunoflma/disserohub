// Empacota o servidor (TypeScript) em um único arquivo ESM em dist/server.
import { build } from 'esbuild';
import { copyFileSync, existsSync, renameSync } from 'node:fs';

const managed = existsSync('.dissero-managed');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
};
await build({ ...common, entryPoints: ['server/index.ts'], outfile: managed ? 'dist/server/index.legacy.js' : 'dist/server/index.js' });
await build({ ...common, entryPoints: ['server/updates/worker.ts'], outfile: 'dist/server/update-worker.js' });
await build({ ...common, entryPoints: ['server/updates/bootstrap.ts'], outfile: 'dist/server/bootstrap.js' });
if (managed) {
  copyFileSync('dist/server/bootstrap.js', 'dist/server/index.next.js');
  renameSync('dist/server/index.next.js', 'dist/server/index.js');
}
