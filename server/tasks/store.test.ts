import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeliveryInfo } from '../../shared/types';
import { ProjectTaskStore, taskDelivery } from './store';

const project = { id: 'project-a', path: 'C:\\Work\\Project' };
const fields = { title: 'Revisar relatório', description: 'Conferir os resultados', owner: 'Bruno', priority: 'high', status: 'todo', criteria: ['Dados conferidos'], dependsOn: [] };
const delivery = { id: 'delivery-1', account: 'local', sessionId: 'session-1', project: 'c:/work/project/', headline: 'Relatório pronto', text: 'Resultado completo', request: 'Gerar relatório', startedAt: 1, finishedAt: 2, tools: 3, edited: [], attachments: [] } as unknown as DeliveryInfo;
const review = (extra = {}) => ({ id: 'review-001', version: 1, verdict: 'accepted', note: '', criteria: fields.criteria, deliveryId: delivery.id, fingerprint: taskDelivery(delivery).fingerprint, ...extra });
describe('persistent project tasks', () => {
  let dir: string; let file: string; let store: ProjectTaskStore;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dissero-tasks-')); file = join(dir, 'tasks.json'); store = new ProjectTaskStore(file, () => 123); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
  const create = (id = 'task-0001', extra = {}) => store.create(project, { id, ...fields, ...extra });

  it('survives service restart and returns independent copies', async () => {
    const task = await create(); task.title = 'mutated outside';
    expect(await new ProjectTaskStore(file).list()).toEqual([expect.objectContaining({ title: fields.title, projectPath: project.path, version: 1 })]);
  });
  it('makes a repeated create idempotent and rejects different content', async () => {
    await create(); await create(); expect(await store.list()).toHaveLength(1);
    await expect(create('task-0001', { title: 'Different' })).rejects.toMatchObject({ status: 409 });
  });
  it('serializes concurrent creations without losing tasks', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => create(`task-000${i}`)));
    expect(await store.list()).toHaveLength(8); expect(await readdir(dir)).toEqual(['tasks.json']);
  });
  it('accepts only one concurrent edit at the same revision', async () => {
    await create(); const results = await Promise.allSettled([store.update('task-0001', { ...fields, version: 1, title: 'A' }), store.update('task-0001', { ...fields, version: 1, title: 'B' })]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await store.list())[0]).toMatchObject({ title: 'A', version: 2 });
  });
  it('preserves corrupt data and refuses writes instead of replacing it', async () => {
    await writeFile(file, '{corrupt');
    await expect(store.list()).rejects.toMatchObject({ status: 503 });
    await expect(create()).rejects.toMatchObject({ status: 503 });
    expect(await readFile(file, 'utf8')).toBe('{corrupt');
  });
  it('preserves the previous file when an atomic write cannot proceed', async () => {
    await create(); const original = await readFile(file, 'utf8');
    // A file occupying the parent path makes storage unavailable on every platform.
    const unavailable = new ProjectTaskStore(join(file, 'child.json'));
    await expect(unavailable.create(project, { id: 'task-0002', ...fields })).rejects.toMatchObject({ status: 503 });
    expect(await readFile(file, 'utf8')).toBe(original);
  });
  it('rejects missing, foreign and cyclic dependencies', async () => {
    await create(); await create('task-0002', { dependsOn: ['task-0001'] });
    await expect(store.update('task-0001', { ...fields, version: 1, dependsOn: ['task-0002'] })).rejects.toMatchObject({ status: 400 });
    await expect(create('task-0003', { dependsOn: ['missing1'] })).rejects.toMatchObject({ status: 400 });
    await expect(store.create({ id: 'other', path: '/other' }, { ...fields, id: 'task-0004', dependsOn: ['task-0001'] })).rejects.toMatchObject({ status: 400 });
  });
  it('requires a manual review to reach done', async () => {
    expect(() => create('task-0001', { status: 'done' })).toThrow();
    await create(); expect(() => store.update('task-0001', { ...fields, version: 1, status: 'done' })).toThrow();
  });
  it('requires every criterion and completed dependencies for approval', async () => {
    await create(); await create('task-0002', { dependsOn: ['task-0001'] });
    await expect(store.review('task-0001', review({ criteria: [] }), async () => [delivery])).rejects.toMatchObject({ status: 409 });
    await expect(store.review('task-0002', review(), async () => [delivery])).rejects.toMatchObject({ status: 409 });
    await store.review('task-0001', review(), async () => [delivery]);
    expect((await store.review('task-0002', review(), async () => [delivery])).status).toBe('done');
  });
  it('ties approval to exact delivery content and matching project', async () => {
    await create();
    await expect(store.review('task-0001', review(), async () => [{ ...delivery, text: 'Changed' }])).rejects.toMatchObject({ status: 409 });
    await expect(store.review('task-0001', review(), async () => [{ ...delivery, project: '/another' }])).rejects.toMatchObject({ status: 409 });
    await expect(store.review('task-0001', review(), async () => [])).rejects.toMatchObject({ status: 409 });
    expect((await store.list())[0].reviews).toEqual([]);
  });
  it('records accepted review durably and retries without duplicating it', async () => {
    await create(); await store.review('task-0001', review(), async () => [delivery]);
    const task = await store.review('task-0001', review(), async () => []);
    expect(task).toMatchObject({ status: 'done', version: 2 }); expect(task.reviews).toHaveLength(1);
    expect((await new ProjectTaskStore(file).list())[0].reviews[0].delivery).toEqual(taskDelivery(delivery));
    await expect(store.review('task-0001', review({ note: 'Changed' }), async () => [delivery])).rejects.toMatchObject({ status: 409 });
  });
  it('requires an adjustment reason, keeps history and reopens edited approvals', async () => {
    await create(); expect(() => store.review('task-0001', review({ verdict: 'changes_requested' }), async () => [delivery])).toThrow();
    await store.review('task-0001', review({ verdict: 'changes_requested', note: 'Corrigir os totais', criteria: [] }), async () => [delivery]);
    await store.review('task-0001', review({ id: 'review-002', version: 2 }), async () => [delivery]);
    const edited = await store.update('task-0001', { ...fields, version: 3, status: 'review', title: 'Nova versão' });
    expect(edited.status).toBe('review'); expect(edited.reviews.map(r => r.verdict)).toEqual(['changes_requested', 'accepted']);
  });
  it('rejects invalid fields before touching storage', async () => {
    for (const extra of [{ title: '' }, { title: 'x'.repeat(181) }, { criteria: ['same', 'same'] }, { priority: 'urgent' }, { owner: 123 }, { dependsOn: ['bad/id'] }]) {
      expect(() => create('task-0001', extra)).toThrow();
    }
    expect(await store.list()).toEqual([]);
  });
});
