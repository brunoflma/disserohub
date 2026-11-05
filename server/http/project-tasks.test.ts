import http from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { Office } from '../model/office';
import { NameStore } from '../model/names';
import { ProjectTaskStore } from '../tasks/store';
import type { DeliveryIndex } from '../deliveries/deliveries';
import type { DeliveryInfo } from '../../shared/types';
import { tempDir } from '../test/fixtures';
import { listenForFetch } from '../test/fetch-server';
import { createApiHandler } from './app';
import { Hub } from './sse';

describe('project task API boundaries and review workflow', () => {
  let fixture: ReturnType<typeof tempDir>; let server: http.Server; let hub: Hub; let office: Office;
  let base: string; let projectId: string; let remote: boolean; let store: ProjectTaskStore;
  const fields = { id: 'task-0001', title: 'Validar entrega', description: '', owner: '', priority: 'normal', status: 'review', criteria: ['Conferido'], dependsOn: [] };
  beforeEach(async () => {
    fixture = tempDir('dissero-task-api-'); remote = false;
    office = new Office({ names: new NameStore(null), version: 'test', startedAt: Date.now(), accounts: () => [], sources: () => [], accountName: () => undefined });
    projectId = office.registerProject(fixture.dir);
    hub = new Hub(office, { throttleMs: 10 }); hub.start();
    store = new ProjectTaskStore(join(fixture.dir, 'tasks.json'));
    const delivery = { id: 'delivery-1', account: 'local', sessionId: 'session-1', project: fixture.dir, headline: 'Pronto', request: 'Trabalho', text: 'Resultado', startedAt: 1, finishedAt: 2, tools: [], edited: [], attachments: [] } as unknown as DeliveryInfo;
    const api = createApiHandler({ office, hub, accounts: new AccountsService({ dirs: [], home: fixture.dir, env: {}, onChange: () => {} }), projectTasks: store,
      deliveries: { list: async () => [delivery] } as unknown as DeliveryIndex, sources: () => [], version: 'test', inDocker: false, remote: { is: () => remote, allows: () => true } });
    server = http.createServer((req, res) => { if (!api(req, res, new URL(req.url ?? '/', 'http://localhost'))) { res.writeHead(404); res.end(); } });
    base = `http://127.0.0.1:${await listenForFetch(server)}`;
  });
  afterEach(async () => { hub.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fixture.cleanup(); });
  const post = (path: string, body: unknown, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('persists tasks, lists project deliveries and records manual approval', async () => {
    expect(await (await fetch(`${base}/api/access`)).json()).toMatchObject({ projectTasks: true });
    expect((await post('/api/project-tasks', { ...fields, projectId })).status).toBe(201);
    const { deliveries } = await (await fetch(`${base}/api/project-tasks/task-0001/deliveries`)).json();
    expect(deliveries[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const result = await post('/api/project-tasks/task-0001/reviews', { id: 'review-001', version: 1, verdict: 'accepted', note: '', criteria: fields.criteria, deliveryId: deliveries[0].id, fingerprint: deliveries[0].fingerprint });
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ task: { status: 'done', version: 2 } });
    expect(await new ProjectTaskStore(join(fixture.dir, 'tasks.json')).list()).toHaveLength(1);
    expect(office.list()).toHaveLength(0);
  });
  it('denies remote, untrusted Host, cross-origin, demo and non-JSON writes', async () => {
    remote = true; expect((await fetch(`${base}/api/project-tasks`)).status).toBe(403);
    expect((await post('/api/project-tasks', { ...fields, projectId })).status).toBe(403); remote = false;
    const untrustedHost = await new Promise<number>(resolve => {
      http.get(`${base}/api/project-tasks`, { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode!); });
    });
    expect(untrustedHost).toBe(403);
    expect((await fetch(`${base}/api/project-tasks`, { headers: { Origin: 'https://evil.invalid' } })).status).toBe(403);
    expect((await post('/api/project-tasks', { ...fields, projectId }, { 'Content-Type': 'text/plain' })).status).toBe(415);
    office.setDemo(true); expect((await post('/api/project-tasks', { ...fields, projectId })).status).toBe(403);
    expect(await store.list()).toEqual([]);
  });
  it('rejects arbitrary project paths and stale updates without changing saved data', async () => {
    expect((await post('/api/project-tasks', { ...fields, projectId: 'unknown', projectPath: fixture.dir })).status).toBe(400);
    await post('/api/project-tasks', { ...fields, projectId });
    const result = await fetch(`${base}/api/project-tasks/task-0001`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, version: 0, title: 'Lost edit' }) });
    expect(result.status).toBe(409); expect((await store.list())[0].title).toBe(fields.title);
  });
  it('uses correct method handling and preserves errors as JSON', async () => {
    expect((await fetch(`${base}/api/project-tasks`, { method: 'DELETE' })).status).toBe(405);
    const result = await post('/api/project-tasks/task-0001/reviews', { id: 'review-001', version: 1, verdict: 'accepted', criteria: [], note: '' });
    expect(result.status).toBe(404); expect((await result.json()).error).toBeTruthy();
  });
});
