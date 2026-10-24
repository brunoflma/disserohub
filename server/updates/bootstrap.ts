import { closeSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { currentId, decide, decision, readTransaction, releasePath, transactionDir } from './state';

// This file stays at the supervisor's fixed entrypoint, outside versioned releases.
const base = dirname(fileURLToPath(import.meta.url));
const installRoot = join(base, '..', '..');
process.env.HABBLAUD_INSTALL_ROOT = installRoot;
const dataDir = process.env.HABBLAUD_DATA_DIR;
let target = join(base, 'index.legacy.js');
let watchdog: ReturnType<typeof setInterval> | undefined;
if (dataDir) {
  const id = currentId(dataDir);
  if (id) {
    const tx = readTransaction(dataDir, id);
    if (!decision(dataDir, id)) {
      try { closeSync(openSync(join(transactionDir(dataDir, id), 'attempted'), 'wx')); }
      catch { decide(dataDir, id, 'rollback'); }
      if (Date.now() >= tx.deadline) decide(dataDir, id, 'rollback');
    }
    const ref = decision(dataDir, id) === 'rollback' ? tx.previous : tx.target;
    if (ref) {
      const root = releasePath(dataDir, ref);
      process.chdir(root);
      target = join(root, 'dist', 'server', 'index.js');
    }
    if (!decision(dataDir, id)) {
      watchdog = setInterval(() => {
        const result = decision(dataDir, id);
        if (result === 'rollback') process.exit(1);
        if (result === 'commit') { clearInterval(watchdog); return; }
        if (Date.now() >= tx.deadline && decide(dataDir, id, 'rollback') === 'rollback') process.exit(1);
      }, 1_000);
      watchdog.unref();
    }
    try { await import(pathToFileURL(target).href); }
    catch {
      clearInterval(watchdog);
      if (!decision(dataDir, id)) decide(dataDir, id, 'rollback');
      // Let the existing supervisor start the previous release.
      process.exit(1);
    }
  } else await import(pathToFileURL(target).href);
} else await import(pathToFileURL(target).href);
