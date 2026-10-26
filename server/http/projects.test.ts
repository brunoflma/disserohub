import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { Office } from '../model/office';
import { NameStore } from '../model/names';
import { ProjectFolders } from '../projects/folders';
import { tempDir } from '../test/fixtures';
import { createApiHandler } from './app';
import { createRequestGuard } from './guard';
import { Hub } from './sse';

describe('cadastro local de projetos', () => {
  let fixture: ReturnType<typeof tempDir>;
  let server: http.Server;
  let hub: Hub;
  let projects: ProjectFolders;
  let base: string;
  let project: string;
  let remote = false;

  beforeEach(async () => {
    fixture = tempDir('habblaud-project-api-');
    project = join(fixture.dir, 'Peças jurídicas');
    mkdirSync(project);
    writeFileSync(join(fixture.dir, 'arquivo.txt'), 'não é uma pasta');
    projects = new ProjectFolders(join(fixture.dir, 'state', 'projects.json'), fixture.dir);
    projects.load();
    remote = false;
    const office = new Office({ names: new NameStore(null), version: 'test', startedAt: Date.now(), accounts: () => [], sources: () => [], accountName: () => undefined });
    hub = new Hub(office, { throttleMs: 10 });
    hub.start();
    const accounts = new AccountsService({ dirs: [], home: fixture.dir, env: {}, onChange: () => undefined });
    const api = createApiHandler({ office, hub, accounts, projects, sources: () => [], version: 'test', inDocker: false, remote: { is: () => remote, allows: () => true } });
    const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
    server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!api(req, res, new URL(req.url ?? '/', 'http://localhost'))) { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    hub.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.cleanup();
  });

  it('lista pastas e mantém a sala cadastrada sem abrir uma sessão', async () => {
    expect(await (await fetch(`${base}/api/access`)).json()).toMatchObject({ projects: true });
    const view = await (await fetch(`${base}/api/projects/folders`)).json();
    expect(view.folders.map((f: { path: string }) => f.path)).toEqual([project]);
    const add = () => fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: project }) });
    expect((await add()).status).toBe(201);
    expect((await add()).status).toBe(201);
    const snapshot = await (await fetch(`${base}/api/snapshot`)).json() as OfficeSnapshot;
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.rooms).toHaveLength(1);
    expect(snapshot.rooms[0]).toMatchObject({ path: project, registered: true });
    const restored = new ProjectFolders(join(fixture.dir, 'state', 'projects.json'), fixture.dir);
    restored.load();
    const restarted = new Office({ names: new NameStore(null), version: 'test', startedAt: Date.now(), accounts: () => [], sources: () => [], accountName: () => undefined });
    for (const entry of restored.entries()) restarted.registerProject(entry.path, entry.createdAt);
    const resumed = restarted.commit().snapshot;
    expect(resumed.rooms).toHaveLength(1);
    expect(resumed.rooms[0]).toMatchObject({ id: snapshot.rooms[0].id, registered: true });
  });

  it('nega acesso remoto e outra origem antes de acessar as pastas', async () => {
    remote = true;
    expect((await fetch(`${base}/api/projects/folders`)).status).toBe(403);
    expect((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: project }) })).status).toBe(403);
    expect((await fetch(`${base}/api/projects`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: project }) })).status).toBe(403);
    expect(await (await fetch(`${base}/api/access`)).json()).toMatchObject({ projects: false });
    remote = false;
    expect((await fetch(`${base}/api/projects/folders`, { headers: { Origin: 'https://outro.example' } })).status).toBe(403);
    expect((await fetch(`${base}/api/projects`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Origin: 'https://outro.example' }, body: JSON.stringify({ path: project }) })).status).toBe(403);
    expect(projects.entries()).toEqual([]);
  });

  it('remove só o cadastro e preserva a pasta física', async () => {
    const add = () => fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: project }) });
    expect((await add()).status).toBe(201);

    const remove = () => fetch(`${base}/api/projects`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: project }) });
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ removed: true, path: project });
    expect(projects.entries()).toEqual([]);
    expect(existsSync(project)).toBe(true);

    const reloaded = new ProjectFolders(join(fixture.dir, 'state', 'projects.json'), fixture.dir);
    reloaded.load();
    expect(reloaded.entries()).toEqual([]);
    expect((await (await fetch(`${base}/api/snapshot`)).json() as OfficeSnapshot).rooms).toEqual([]);
    expect((await remove()).status).toBe(404);
  });

  it('rejeita caminhos inválidos e métodos indevidos sem cadastrar sala', async () => {
    for (const path of ['pasta-relativa', join(fixture.dir, 'arquivo.txt'), '\\\\servidor\\pasta']) {
      expect((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })).status).toBe(400);
    }
    expect((await fetch(`${base}/api/projects`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'relativa' }) })).status).toBe(400);
    expect((await fetch(`${base}/api/projects/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(405);
    expect(projects.entries()).toEqual([]);
    const snapshot = await (await fetch(`${base}/api/snapshot`)).json() as OfficeSnapshot;
    expect(snapshot.rooms).toEqual([]);
  });
});
