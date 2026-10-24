import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateInstaller, validateCandidate } from './installer';
import { localInstallRequest } from './http';
import { atomicJson, currentId, decide, decision, readJson, saveStatus, selectedRelease, transactionDir, updateDir } from './state';

const dirs: string[] = [];
const fixture = () => { const dir = mkdtempSync(join(tmpdir(), 'dissero-update-test-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const id = 'a'.repeat(32);
const ref = { dir: 'v1.0.3.4-123456789abc-aaaaaaaa', version: '1.0.3.4', sha: '1'.repeat(40) };
function request(over: { host?: string; origin?: string; address?: string; encrypted?: boolean } = {}): IncomingMessage {
  return { headers: { host: 'localhost:4748', origin: 'http://localhost:4748', 'content-type': 'application/json', ...('host' in over ? { host: over.host } : {}), ...('origin' in over ? { origin: over.origin } : {}) }, socket: { remoteAddress: over.address ?? '127.0.0.1', encrypted: over.encrypted } } as unknown as IncomingMessage;
}

describe('installer request boundary', () => {
  it('requires exact local origin for writes, independent of the general HTTP allowlist', () => {
    expect(localInstallRequest(request(), false, true)).toBe(true);
    for (const over of [{ origin: undefined }, { origin: 'null' }, { origin: 'http://127.0.0.1:4748' }, { origin: 'https://localhost:4748' }, { origin: 'http://evil.test' }, { host: 'office.example' }, { address: '192.168.1.2' }]) expect(localInstallRequest(request(over), false, true)).toBe(false);
    expect(localInstallRequest(request(), true, true)).toBe(false);
    expect(localInstallRequest(request({ origin: undefined, address: '::ffff:127.0.0.1' }), false, false)).toBe(true);
    expect(localInstallRequest(request({ origin: 'https://localhost:4748', encrypted: true }), false, true)).toBe(true);
  });
});
describe('durable activation arbitration', () => {
  it('a late success cannot overwrite watchdog rollback', () => {
    const data = fixture();
    atomicJson(join(transactionDir(data, id), 'transaction.json'), { protocol: 1, target: ref, previous: null, deadline: Date.now() + 1000 });
    atomicJson(join(updateDir(data), 'active.json'), { id });
    expect(decide(data, id, 'rollback')).toBe('rollback');
    expect(decide(data, id, 'commit')).toBe('rollback');
    expect(decision(data, id)).toBe('rollback');
    expect(selectedRelease(data)).toBeNull();
    expect(currentId(data)).toBe(id);
  });
  it('a committed release cannot be overwritten by a late watchdog', () => {
    const data = fixture();
    atomicJson(join(transactionDir(data, id), 'transaction.json'), { protocol: 1, target: ref, previous: null, deadline: Date.now() + 1000 });
    atomicJson(join(updateDir(data), 'active.json'), { id });
    expect(decide(data, id, 'commit')).toBe('commit');
    expect(decide(data, id, 'rollback')).toBe('commit');
    expect(selectedRelease(data)).toEqual(ref);
  });
  it('rejects malformed references instead of following paths outside releases', () => {
    const data = fixture();
    atomicJson(join(transactionDir(data, id), 'transaction.json'), { protocol: 1, target: { ...ref, dir: '../integration' }, previous: null, deadline: Date.now() });
    atomicJson(join(updateDir(data), 'active.json'), { id });
    expect(() => selectedRelease(data)).toThrow('Invalid update transaction');
  });
});
function installer(over: Partial<ConstructorParameters<typeof UpdateInstaller>[0]> = {}) {
  const dataDir = fixture();
  const launch = vi.fn((_plan: string) => process.pid);
  const network = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v1.0.3.4', draft: false, prerelease: false })));
  const runtime = vi.fn(async () => ({ supervisorPid: 900, appPid: process.pid }));
  const manager = new UpdateInstaller({ enabled: true, managed: true, dataDir, rootDir: dataDir, version: '1.0.3.2', repo: 'brunoflma/disserohub', port: 4748, hasSessions: () => false, fetch: network, runtime, launch, ...over });
  return { manager, launch, network, runtime, dataDir };
}
describe('installation admission', () => {
  it('blocks recovery from a rollback even when public status already says error', () => {
    const s = installer({ version: ref.version });
    atomicJson(join(transactionDir(s.dataDir, id), 'transaction.json'), { protocol: 1, target: ref, previous: null, deadline: Date.now() });
    atomicJson(join(updateDir(s.dataDir), 'active.json'), { id });
    decide(s.dataDir, id, 'rollback');
    saveStatus(s.dataDir, { supported: true, phase: 'error', target: ref.version });
    expect(s.manager.busy).toBe(true);
    expect(s.runtime).toHaveBeenCalledWith(s.dataDir, 'restart');
  });
  it('keeps terminal admission closed while recovering a dead worker after pointer publication', async () => {
    const s = installer();
    atomicJson(join(transactionDir(s.dataDir, id), 'transaction.json'), { protocol: 1, target: ref, previous: null, deadline: Date.now() + 10000 });
    atomicJson(join(updateDir(s.dataDir), 'active.json'), { id });
    atomicJson(join(updateDir(s.dataDir), 'install.lock'), { id, owner: process.pid, worker: 2147483647 });
    saveStatus(s.dataDir, { supported: true, phase: 'restarting', target: ref.version });
    expect(s.manager.status().phase).toBe('restarting');
    expect(decision(s.dataDir, id)).toBe('rollback');
    expect(s.manager.busy).toBe(true);
    expect(s.runtime).toHaveBeenCalledWith(s.dataDir, 'restart');
    await expect(s.manager.start('1.0.3.4')).rejects.toThrow('andamento');
  });

  it('finishes recovery only when running the restored version', () => {
    const s = installer();
    atomicJson(join(transactionDir(s.dataDir, id), 'transaction.json'), { protocol: 1, target: ref, previous: null, deadline: Date.now() });
    atomicJson(join(updateDir(s.dataDir), 'active.json'), { id });
    decide(s.dataDir, id, 'rollback');
    saveStatus(s.dataDir, { supported: true, phase: 'restarting', target: ref.version });
    expect(s.manager.status().phase).toBe('rolled-back');
    expect(s.manager.busy).toBe(false);
  });
  it('rejects active or pending owned sessions before network/download/restart', async () => {
    const s = installer({ hasSessions: () => true });
    await expect(s.manager.start('1.0.3.4')).rejects.toThrow('terminais');
    expect(s.network).not.toHaveBeenCalled();
    expect(s.launch).not.toHaveBeenCalled();
    expect(s.manager.busy).toBe(false);
  });
  it('closes admission synchronously, suppresses duplicate installs, persists a detached job', async () => {
    let release!: (v: { supervisorPid: number; appPid: number }) => void;
    const runtime = () => new Promise<{ supervisorPid: number; appPid: number }>((resolve) => { release = resolve; });
    const s = installer({ runtime });
    const first = s.manager.start('1.0.3.4');
    expect(s.manager.busy).toBe(true);
    await expect(s.manager.start('1.0.3.4')).rejects.toThrow('andamento');
    release({ supervisorPid: 900, appPid: process.pid });
    expect((await first).phase).toBe('preparing');
    expect(s.launch).toHaveBeenCalledOnce();
    expect(readJson<{ worker: number }>(join(updateDir(s.dataDir), 'install.lock'))?.worker).toBe(process.pid);
    const plan = JSON.parse(readFileSync(s.launch.mock.calls[0][0], 'utf8'));
    expect(plan.version).toBe('1.0.3.4');
    expect(plan.previousVersion).toBe('1.0.3.2');
  });
  it('rejects changed releases, arbitrary commands and unmanaged instances', async () => {
    const s = installer();
    await expect(s.manager.start('1.0.3.5')).rejects.toThrow('mudou');
    await expect(s.manager.start('1.0.3.4 & echo fail')).rejects.toThrow('inválida');
    expect(s.launch).not.toHaveBeenCalled();
    const other = installer({ runtime: async () => ({ supervisorPid: 900, appPid: process.pid + 1 }) });
    await expect(other.manager.start('1.0.3.4')).rejects.toThrow('instância');
  });
  it('candidate must retain the installer and preserve the data schema', () => {
    const data = fixture();
    const pkg = { version: '1.0.3', repository: 'brunoflma/disserohub', disserohub: { revision: 4, updateProtocol: 1, dataSchema: 0 } };
    writeFileSync(join(data, 'package.json'), JSON.stringify(pkg));
    expect(() => validateCandidate(data, '1.0.3.4', 0)).not.toThrow();
    expect(() => validateCandidate(data, '1.0.3.4', 1)).toThrow();
    delete (pkg.disserohub as { updateProtocol?: number }).updateProtocol;
    writeFileSync(join(data, 'package.json'), JSON.stringify(pkg));
    expect(() => validateCandidate(data, '1.0.3.4', 0)).toThrow();
  });
});
