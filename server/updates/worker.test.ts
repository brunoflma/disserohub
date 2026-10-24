import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { performInstall, type WorkerServices } from './worker';
import { atomicJson, currentId, decide, publicStatus, selectedRelease, updateDir } from './state';
import type { InstallPlan } from './installer';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'dissero-worker-test-'));
  dirs.push(dataDir);
  const plan: InstallPlan = { id: 'b'.repeat(32), dataDir, version: '1.0.3.4', previousVersion: '1.0.3.2', port: 4748, schema: 0 };
  atomicJson(join(updateDir(dataDir), 'install.lock'), { id: plan.id, worker: process.pid });
  const run = vi.fn(async (_exe: string, args: string[], _cwd: string) => {
    if (args.includes('clone')) {
      const root = args.at(-1)!;
      mkdirSync(root);
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.3', repository: 'brunoflma/disserohub', disserohub: { revision: 4, updateProtocol: 1, dataSchema: 0 } }));
    }
    return args.includes('rev-parse') ? '1'.repeat(40) : '';
  });
  const runtime = vi.fn(async () => ({ supervisorPid: 50, appPid: 60 }));
  const ready = vi.fn(async () => {});
  const recovered = vi.fn(async () => true);
  const services: WorkerServices = { run, runtime, ready, recovered };
  return { plan, services, run, runtime, ready, recovered };
}
it('builds an isolated official release, activates it and retains installer eligibility metadata', async () => {
  const s = setup();
  await performInstall(s.plan, s.services);
  expect(publicStatus(s.plan.dataDir)?.phase).toBe('done');
  expect(selectedRelease(s.plan.dataDir)?.version).toBe('1.0.3.4');
  expect(currentId(s.plan.dataDir)).toBe(s.plan.id);
  expect(s.runtime).toHaveBeenCalledTimes(1);
  expect(s.run.mock.calls[0][1]).toContain('https://github.com/brunoflma/disserohub.git');
  expect(s.run.mock.calls[0][1]).toContain('v1.0.3.4');
  expect(s.run.mock.calls.filter(([, args]) => args.includes('ci'))).toHaveLength(1);
});
it('never activates or restarts when preparation fails', async () => {
  const s = setup();
  s.run.mockRejectedValueOnce(new Error('private diagnostic must stay internal'));
  await performInstall(s.plan, s.services);
  expect(publicStatus(s.plan.dataDir)?.phase).toBe('error');
  expect(JSON.stringify(publicStatus(s.plan.dataDir))).not.toContain('private diagnostic');
  expect(currentId(s.plan.dataDir)).toBeUndefined();
  expect(s.runtime).not.toHaveBeenCalled();
});
it('restores the previous version after failed readiness', async () => {
  const s = setup();
  s.ready.mockRejectedValueOnce(new Error('startup failed'));
  await performInstall(s.plan, s.services);
  expect(publicStatus(s.plan.dataDir)?.phase).toBe('rolled-back');
  expect(selectedRelease(s.plan.dataDir)).toBeNull();
  expect(s.runtime).toHaveBeenCalledTimes(2);
  expect(s.recovered).toHaveBeenCalledWith(s.plan, '1.0.3.2');
});
it('a watchdog rollback wins over late successful readiness', async () => {
  const s = setup();
  s.services.ready = async () => { decide(s.plan.dataDir, s.plan.id, 'rollback'); };
  await performInstall(s.plan, s.services);
  expect(publicStatus(s.plan.dataDir)?.phase).toBe('rolled-back');
  expect(selectedRelease(s.plan.dataDir)).toBeNull();
});
