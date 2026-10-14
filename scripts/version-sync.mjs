// Keep the bundled Habblaud-compatible local integrations aligned with this distribution.
// These manifests are unrelated to the hosted Dissero plugin.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid distribution version.');
const files = ['.claude-plugin/marketplace.json', ...['habblaud', 'habblaud-permissoes', 'habblaud-mensagens'].map((name) => `mod/${name}/.claude-plugin/plugin.json`)];
const documents = files.map((file) => ({ file: join(root, file), data: JSON.parse(readFileSync(join(root, file), 'utf8')) }));
for (const { file, data } of documents) {
  data.version = version;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log(`Local integration manifests aligned with Dissero ${version}.`);
