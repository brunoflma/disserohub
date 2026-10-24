import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DISSERO_REPOSITORY } from '../../shared/distribution';
import type { InstallPhase } from '../../shared/update-install';
import { validateCandidate, type InstallPlan } from './installer';
import { runtimeCommand } from './runtime';
import { atomicJson, currentId, decide, decision, JOB_ID, readJson, readTransaction, saveStatus, selectedRelease, transactionDir, updateDir, type ReleaseRef } from './state';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function runCommand(exe: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, shell: false, env: { ...process.env, NODE_OPTIONS: '', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { if (output.length < 65_536) output += chunk.toString(); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Command timed out')); }, 15 * 60_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Command failed')); });
    child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('Command failed')); });
  });
}
export interface WorkerServices {
  run: typeof runCommand;
  runtime: typeof runtimeCommand;
  ready: (plan: InstallPlan, root: string, until: number) => Promise<void>;
  recovered?: (plan: InstallPlan, version: string) => Promise<boolean>;
}
export async function waitReady(plan: InstallPlan, root: string, until: number): Promise<void> {
  const localIndex = readFileSync(join(root, 'dist', 'client', 'index.html'));
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const expected = digest(localIndex);
  const entry = localIndex.toString().match(/src="(\/bundle\/[^"?]+\.js)"/)?.[1];
  if (!entry) throw new Error('Missing client entry');
  const entryHash = digest(readFileSync(join(root, 'dist', 'client', entry)));
  const base = `http://127.0.0.1:${plan.port}`;
  while (Date.now() < until) {
    try {
      const get = (path: string) => fetch(base + path, { signal: AbortSignal.timeout(3_000), cache: 'no-store' });
      const [healthResponse, installResponse, indexResponse, assetResponse] = await Promise.all([get('/api/health'), get('/api/updates/install'), get('/'), get(entry)]);
      if ([healthResponse, installResponse, indexResponse, assetResponse].some((r) => !r.ok)) throw new Error();
      const health = await healthResponse.json() as { version?: string };
      const installer = await installResponse.json() as { supported?: boolean; protocol?: number };
      if (health.version === plan.version && installer.protocol === 1 && installer.supported && digest(new Uint8Array(await indexResponse.arrayBuffer())) === expected && digest(new Uint8Array(await assetResponse.arrayBuffer())) === entryHash) return;
    } catch { /* the service is expected to disconnect while restarting */ }
    await sleep(1_000);
  }
  throw new Error('Readiness timeout');
}
export async function performInstall(plan: InstallPlan, services: WorkerServices = { run: runCommand, runtime: runtimeCommand, ready: waitReady }): Promise<void> {
  if (!JOB_ID.test(plan.id) || !/^\d+\.\d+\.\d+\.\d+$/.test(plan.version) || !Number.isInteger(plan.port) || plan.port < 1 || plan.port > 65535) throw new Error('Invalid install plan');
  const lock = join(updateDir(plan.dataDir), 'install.lock');
  const owns = () => readJson<{ id: string }>(lock)?.id === plan.id;
  if (!owns()) return;
  const phase = (value: InstallPhase, message: string) => {
    if (!owns()) throw new Error('Stale worker');
    saveStatus(plan.dataDir, { protocol: 1, supported: true, phase: value, target: plan.version, message });
  };
  let activated = false;
  try {
    phase('downloading', 'Baixando a versão oficial do DisseroHub.');
    const releases = join(plan.dataDir, 'releases');
    mkdirSync(releases, { recursive: true });
    const staging = join(releases, `.stage-${plan.id}`);
    const git = process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe') : 'git';
    await services.run(git, ['-c', 'core.hooksPath=', 'clone', '--depth', '1', '--branch', `v${plan.version}`, '--single-branch', '--', `https://github.com/${DISSERO_REPOSITORY}.git`, staging], releases);
    validateCandidate(staging, plan.version, plan.schema);
    const sha = await services.run(git, ['rev-parse', 'HEAD'], staging);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid commit');
    phase('dependencies', 'Instalando as dependências da nova versão.');
    const npmCli = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(existsSync);
    if (!npmCli) throw new Error('npm unavailable');
    await services.run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], staging);
    phase('building', 'Compilando e verificando a nova versão.');
    await services.run(process.execPath, [npmCli, 'run', 'typecheck'], staging);
    await services.run(process.execPath, [npmCli, 'run', 'build'], staging);
    validateCandidate(staging, plan.version, plan.schema);
    const ref: ReleaseRef = { dir: `v${plan.version}-${sha.slice(0, 12)}-${plan.id.slice(0, 8)}`, version: plan.version, sha };
    const root = join(releases, ref.dir);
    renameSync(staging, root);
    if (!owns()) throw new Error('Stale worker');
    const oldId = currentId(plan.dataDir);
    if (oldId && !decision(plan.dataDir, oldId)) throw new Error('Unresolved previous activation');
    const previous = selectedRelease(plan.dataDir);
    const deadline = Date.now() + 90_000;
    atomicJson(join(transactionDir(plan.dataDir, plan.id), 'transaction.json'), { protocol: 1, target: ref, previous, deadline });
    phase('restarting', 'Reiniciando o Dissero. A página será recarregada ao concluir.');
    atomicJson(join(updateDir(plan.dataDir), 'active.json'), { id: plan.id });
    activated = true;
    await services.runtime(plan.dataDir, 'restart');
    await services.ready(plan, root, deadline - 5_000);
    if (currentId(plan.dataDir) !== plan.id || decide(plan.dataDir, plan.id, 'commit') !== 'commit') throw new Error('Activation rolled back');
    phase('done', 'Atualização instalada.');
  } catch {
    if (activated && currentId(plan.dataDir) === plan.id && decide(plan.dataDir, plan.id, 'rollback') === 'rollback') {
      try {
        await services.runtime(plan.dataDir, 'restart');
        const tx = readTransaction(plan.dataDir, plan.id);
        const version = tx.previous?.version ?? plan.previousVersion;
        let healthy = services.recovered ? await services.recovered(plan, version) : false;
        for (let n = 0; !services.recovered && n < 30; n++) {
          try { const response = await fetch(`http://127.0.0.1:${plan.port}/api/health`, { signal: AbortSignal.timeout(2_000) }); healthy = response.ok && (await response.json() as { version?: string }).version === version; } catch { /* restart */ }
          if (healthy) break;
          await sleep(1_000);
        }
        phase(healthy ? 'rolled-back' : 'error', healthy ? 'A nova versão não iniciou corretamente. A versão anterior foi restaurada.' : 'A atualização falhou. O serviço está recuperando a versão anterior.');
      } catch { phase('error', 'A atualização falhou. O serviço tentará iniciar a versão anterior.'); }
    } else if (owns()) phase('error', 'Não foi possível preparar a nova versão. A instalação atual foi preservada.');
  } finally {
    if (owns()) unlinkSync(lock);
  }
}

if (basename(process.argv[1] ?? '') === 'update-worker.js') {
  const plan = readJson<InstallPlan>(process.argv[2]);
  if (!plan) process.exitCode = 1;
  else await performInstall(plan).catch(() => { process.exitCode = 1; });
}
