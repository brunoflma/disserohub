import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DISSERO_REPOSITORY, distributionVersion } from '../../shared/distribution';
import { installBusy, type UpdateInstallStatus } from '../../shared/update-install';
import { compareVersions, parseGithubRepo } from './checker';
import { createGithubReleaseFetch } from './github';
import { runtimeCommand } from './runtime';
import { atomicJson, currentId, decide, decision, publicStatus, readJson, readTransaction, saveStatus, updateDir } from './state';

export interface InstallPlan { id: string; dataDir: string; version: string; previousVersion: string; port: number; schema: number }
interface Lease { id: string; owner: number; worker?: number }
export class InstallError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface InstallerOptions {
  dataDir: string; rootDir: string; version: string; repo?: string; port: number;
  enabled: boolean; hasSessions: () => boolean;
  fetch?: typeof fetch; runtime?: typeof runtimeCommand;
  launch?: (plan: string) => number;
  managed?: boolean;
}
function alive(pid: number | undefined): boolean { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } }
export function packageSchema(root: string): number {
  const pkg = readJson<{ disserohub?: { dataSchema?: number } }>(join(root, 'package.json'));
  return pkg?.disserohub?.dataSchema ?? 0;
}
export class UpdateInstaller {
  private starting = false;
  private recovering = false;
  private broken = false;
  private readonly worker = join(dirname(fileURLToPath(import.meta.url)), 'update-worker.js');
  constructor(private readonly opts: InstallerOptions) { queueMicrotask(() => this.status()); }
  private get supported(): boolean {
    return this.opts.enabled && this.opts.repo === DISSERO_REPOSITORY &&
      (this.opts.managed ?? (process.platform === 'win32' && !!process.env.HABBLAUD_INSTALL_ROOT && existsSync(this.worker)));
  }
  get busy(): boolean { return this.starting || this.recovering || installBusy(this.status().phase) || this.broken; }
  status(): UpdateInstallStatus {
    try { return this.readStatus(); }
    catch {
      this.broken = true;
      return { protocol: 1, supported: this.supported, phase: 'error', message: 'Não foi possível ler ou gravar o estado da atualização. Reinicie o serviço após conferir o armazenamento local.' };
    }
  }
  private readStatus(): UpdateInstallStatus {
    if (!this.supported) return { protocol: 1, supported: false, phase: 'idle', reason: 'Instalação automática disponível no serviço nativo local do Dissero.' };
    const status = publicStatus(this.opts.dataDir);
    const lease = readJson<Lease>(join(updateDir(this.opts.dataDir), 'install.lock'));
    const active = currentId(this.opts.dataDir);
    const tx = active ? readTransaction(this.opts.dataDir, active) : undefined;
    const result = active ? decision(this.opts.dataDir, active) : undefined;
    // Activation state is authoritative even if a worker died before saving public status.
    if (active && tx && (!result || (result === 'rollback' && this.opts.version === tx.target.version))) {
      const recovery: UpdateInstallStatus = { ...status, protocol: 1, supported: true, target: tx.target.version, phase: 'restarting', message: 'Validando a troca de versão do Dissero.' };
      if (!alive(lease?.worker) && !this.starting) {
        decide(this.opts.dataDir, active, 'rollback');
        recovery.message = 'A instalação foi interrompida. Restaurando a versão anterior.';
        saveStatus(this.opts.dataDir, recovery);
        if (!this.recovering) {
          this.recovering = true;
          void (this.opts.runtime ?? runtimeCommand)(this.opts.dataDir, 'restart').catch(() => {
            this.failureStatus({ ...recovery, phase: 'error', message: 'Não foi possível reiniciar o serviço. Reinicie o Dissero para restaurar a versão anterior.' });
          });
        }
      }
      return recovery;
    }
    if (status && installBusy(status.phase)) {
      if (!lease || (!alive(lease.worker) && (!alive(lease.owner) || lease.owner === process.pid) && !this.starting)) {
        if (tx) {
          if (tx.target.version === status.target) {
            if (result === 'commit' && this.opts.version === tx.target.version) {
              const done: UpdateInstallStatus = { ...status, protocol: 1, supported: true, phase: 'done', message: 'Atualização instalada.' };
              saveStatus(this.opts.dataDir, done);
              return done;
            }
            if (result === 'rollback') {
              const restored: UpdateInstallStatus = { ...status, protocol: 1, supported: true, phase: 'rolled-back', message: 'A instalação foi interrompida. A versão anterior foi restaurada.' };
              saveStatus(this.opts.dataDir, restored);
              return restored;
            }
          }
        }
        const failed: UpdateInstallStatus = { ...status, protocol: 1, supported: true, phase: 'error', message: 'A instalação foi interrompida. Você pode tentar novamente.' };
        saveStatus(this.opts.dataDir, failed);
        return failed;
      }
    }
    return { ...status, protocol: 1, supported: true, phase: status?.phase ?? 'idle' };
  }
  async start(expected: unknown): Promise<UpdateInstallStatus> {
    if (!this.supported) throw new InstallError(409, this.status().reason!);
    if (this.busy) throw new InstallError(409, 'Já existe uma atualização em andamento.');
    if (typeof expected !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(expected)) throw new InstallError(400, 'Versão inválida.');
    // Set admission gate before the first await, then check pending takeovers as well as PTYs.
    this.starting = true;
    const id = randomBytes(16).toString('hex');
    const lock = join(updateDir(this.opts.dataDir), 'install.lock');
    let acquired = false;
    try {
      if (this.opts.hasSessions()) throw new InstallError(409, 'Encerre os terminais abertos no Dissero antes de atualizar.');
      const native = await (this.opts.runtime ?? runtimeCommand)(this.opts.dataDir, 'status');
      if (native.appPid !== process.pid) throw new InstallError(409, 'Esta instância não pertence ao serviço nativo.');
      mkdirSync(updateDir(this.opts.dataDir), { recursive: true });
      const previous = readJson<Lease>(lock);
      if (previous) {
        if (alive(previous.worker) || (previous.owner !== process.pid && alive(previous.owner))) throw new InstallError(409, 'Já existe uma atualização em andamento.');
        unlinkSync(lock);
      }
      try { writeFileSync(lock, JSON.stringify({ id, owner: process.pid }), { flag: 'wx', mode: 0o600 }); acquired = true; }
      catch { throw new InstallError(409, 'Já existe uma atualização em andamento.'); }
      const response = await (this.opts.fetch ?? createGithubReleaseFetch())(`https://api.github.com/repos/${DISSERO_REPOSITORY}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Dissero-Updater' }, signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
      if (!response.ok) throw new InstallError(502, 'Não foi possível consultar a versão oficial. Tente novamente.');
      const release = await response.json() as { tag_name?: string; draft?: boolean; prerelease?: boolean };
      if (release.draft || release.prerelease || release.tag_name !== `v${expected}` || compareVersions(expected, this.opts.version) <= 0) throw new InstallError(409, 'A versão disponível mudou. Verifique novamente antes de atualizar.');
      if (this.opts.hasSessions()) throw new InstallError(409, 'Encerre os terminais abertos no Dissero antes de atualizar.');
      const plan: InstallPlan = { id, dataDir: this.opts.dataDir, version: expected, previousVersion: this.opts.version, port: this.opts.port, schema: packageSchema(this.opts.rootDir) };
      const file = join(updateDir(this.opts.dataDir), `job-${id}.json`);
      atomicJson(file, plan);
      const status: UpdateInstallStatus = { protocol: 1, supported: true, phase: 'preparing', target: expected, startedAt: Date.now(), message: 'Preparando a atualização.' };
      saveStatus(this.opts.dataDir, status);
      const pid = this.opts.launch ? this.opts.launch(file) : this.launch(file);
      atomicJson(lock, { id, owner: process.pid, worker: pid });
      return status;
    } catch (error) {
      if (acquired && readJson<Lease>(lock)?.id === id) unlinkSync(lock);
      if (error instanceof InstallError) throw error;
      throw new InstallError(502, 'Não foi possível iniciar a atualização. Tente novamente.');
    } finally { this.starting = false; }
  }
  private launch(file: string): number {
    const child = spawn(process.execPath, [this.worker, file], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, NODE_OPTIONS: '' } });
    child.on('error', () => this.failureStatus({ protocol: 1, supported: true, phase: 'error', message: 'Não foi possível iniciar o instalador.' }));
    if (!child.pid) throw new Error('Worker did not start');
    child.unref();
    return child.pid;
  }
  private failureStatus(status: UpdateInstallStatus): void {
    try { saveStatus(this.opts.dataDir, status); }
    catch { this.broken = true; }
  }
}

/** Candidate metadata must keep the installer and understand the existing user data. */
export function validateCandidate(root: string, version: string, schema: number): void {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (distributionVersion(pkg) !== version || parseGithubRepo(pkg.repository) !== DISSERO_REPOSITORY || pkg.disserohub?.updateProtocol !== 1 || (pkg.disserohub?.dataSchema ?? 0) !== schema) throw new Error('Incompatible release');
}
