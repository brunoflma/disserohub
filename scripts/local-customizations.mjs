// Read-only inventory, or a reversible source export. Never updates a running installation.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
const lines = (text) => text.split(/\r?\n/).filter(Boolean);
const mode = process.argv[2] ?? 'status';
if (!['status', 'export'].includes(mode)) throw new Error('Use status ou export [diretório fora da instalação].');
const sourcePath = (path) => (/^(client\/src\/|client\/public\/assets\/brand\/|server\/|shared\/|scripts\/|CUSTOMIZATIONS\.md$)/.test(path) && ['.ts', '.css', '.mjs', '.md', '.svg', '.png'].includes(extname(path))) || ['client/index.html', 'client/public/manifest.webmanifest'].includes(path);
const changed = lines(git('diff', '--name-only', 'HEAD')).filter(sourcePath);
const added = lines(git('ls-files', '--others', '--exclude-standard')).filter(sourcePath);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.disserohub?.revision ? `${pkg.version}.${pkg.disserohub.revision}` : pkg.version;
const manifest = {
  createdAt: new Date().toISOString(),
  version,
  baseCommit: git('rev-parse', 'HEAD'),
  canonicalOrigin: git('remote', 'get-url', 'origin') === 'https://github.com/marmottajr/habblaud.git',
  tracked: changed,
  untracked: added,
  layers: { local: [...changed, ...added].filter((path) => path.startsWith('client/src/local/') || path.startsWith('client/src/ui/feed-policy') || path === 'scripts/local-customizations.mjs'), integration: changed.filter((path) => !path.startsWith('client/src/local/')) },
};
if (mode === 'status') {
  console.log(JSON.stringify({ version: manifest.version, baseCommit: manifest.baseCommit, canonicalOrigin: manifest.canonicalOrigin, trackedFiles: changed.length, newSourceFiles: added.length, localLayerFiles: manifest.layers.local.length, requiresCandidateUpgrade: true }));
} else {
  const target = resolve(process.argv[3] ?? join(root, '..', 'setup', `customizations-${Date.now()}`));
  const rel = relative(root, target);
  if (!rel || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) throw new Error('A exportação precisa ficar fora da instalação para não entrar no próprio patch.');
  if (existsSync(target)) throw new Error('O destino já existe. Escolha uma pasta nova para preservar exportações anteriores.');
  mkdirSync(target, { recursive: true });
  // Tracked modifications stay in a standard Git patch; untracked modules are copied alongside it.
  writeFileSync(join(target, 'tracked.patch'), (changed.length ? git('diff', 'HEAD', '--binary', '--', ...changed) + '\n' : ''));
  for (const path of added) {
    const dest = join(target, 'new-files', path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, path), dest);
  }
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ exported: target, baseCommit: manifest.baseCommit, trackedFiles: changed.length, newSourceFiles: added.length }));
}
