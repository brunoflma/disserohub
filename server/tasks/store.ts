import { mkdir, readFile, rename, writeFile, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DeliveryInfo } from '../../shared/types';
import { projectPathKey, type ProjectTask, type TaskDelivery, type TaskDraft, type TaskReview } from '../../shared/project-tasks';

export class TaskError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const invalid = (message = 'Confira os campos da tarefa.'): never => { throw new TaskError(400, message); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const id = (value: unknown): string => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : invalid('Identificador inválido.');
const string = (value: unknown, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /\u0000/.test(value)) return invalid();
  return value.trim();
};
const strings = (value: unknown, max: number, length: number): string[] => {
  if (!Array.isArray(value) || value.length > max) return invalid();
  const result = value.map(v => string(v, length, true));
  if (new Set(result).size !== result.length) return invalid('Remova os itens repetidos.');
  return result;
};
function draft(raw: unknown): TaskDraft {
  const v = object(raw);
  if (!['todo', 'doing', 'blocked', 'review'].includes(v.status as string) || !['low', 'normal', 'high'].includes(v.priority as string)) return invalid();
  return { title: string(v.title, 180, true), description: string(v.description, 6000), owner: string(v.owner, 120),
    priority: v.priority as TaskDraft['priority'], status: v.status as TaskDraft['status'],
    criteria: strings(v.criteria, 30, 300), dependsOn: strings(v.dependsOn, 30, 80).map(id) };
}
export function taskDelivery(delivery: DeliveryInfo): TaskDelivery {
  return { id: delivery.id, sessionId: delivery.sessionId, headline: delivery.headline, finishedAt: delivery.finishedAt,
    fingerprint: createHash('sha256').update(JSON.stringify([delivery.id, delivery.account, delivery.sessionId, delivery.project,
      delivery.finishedAt, delivery.request, delivery.headline, delivery.summary, delivery.text, delivery.edited, delivery.attachments])).digest('hex') };
}

/** One service owns writes. Atomic replacement + revisions protect crashes and concurrent browser tabs. */
export class ProjectTaskStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  async list(): Promise<ProjectTask[]> {
    try {
      if ((await stat(this.file)).size > 8_000_000) throw new Error('size');
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data?.schema !== 1 || !Array.isArray(data.tasks) || data.tasks.length > 2000) throw new Error('schema');
      const ids = new Set<string>();
      for (const task of data.tasks) {
        id(task.id); string(task.projectId, 4096, true); string(task.projectPath, 4096, true);
        draft({ ...task, status: task.status === 'done' ? 'review' : task.status });
        if (ids.has(task.id) || !Number.isSafeInteger(task.version) || task.version < 1 || !Number.isFinite(task.createdAt)
          || !Number.isFinite(task.updatedAt) || !Array.isArray(task.reviews) || task.reviews.length > 1000) throw new Error('task');
        for (const review of task.reviews) {
          id(review.id); string(review.note, 4000); strings(review.criteria, 30, 300);
          if (!['accepted', 'changes_requested'].includes(review.verdict) || !Number.isFinite(review.at)
            || typeof review.delivery?.id !== 'string' || typeof review.delivery.sessionId !== 'string'
            || typeof review.delivery.headline !== 'string' || !Number.isFinite(review.delivery.finishedAt)
            || !/^[a-f0-9]{64}$/.test(review.delivery.fingerprint)) throw new Error('review');
        }
        ids.add(task.id);
      }
      return data.tasks;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new TaskError(503, 'Não foi possível ler as tarefas salvas. O arquivo foi preservado; confira o armazenamento antes de tentar novamente.');
    }
  }

  private mutate<T>(fn: (tasks: ProjectTask[]) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const tasks = await this.list();
      const result = await fn(tasks);
      const pending = `${this.file}.pending-${randomUUID()}`;
      try {
        await mkdir(dirname(this.file), { recursive: true });
        const content = JSON.stringify({ schema: 1, tasks });
        if (Buffer.byteLength(content) > 8_000_000) throw new TaskError(409, 'O armazenamento de tarefas atingiu o limite.');
        await writeFile(pending, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(pending, this.file);
      } catch (error) {
        if (error instanceof TaskError) throw error;
        throw new TaskError(503, 'Não foi possível salvar. As tarefas anteriores foram preservadas.');
      } finally { await unlink(pending).catch(() => {}); }
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private dependencies(tasks: ProjectTask[], task: ProjectTask): void {
    const visit = (next: string, seen: Set<string>): void => {
      if (next === task.id) invalid('Uma tarefa não pode depender de si mesma, nem formar um ciclo.');
      if (seen.has(next)) return;
      seen.add(next);
      const dependency = tasks.find(t => t.id === next && t.projectId === task.projectId);
      if (!dependency) return invalid('Escolha dependências deste projeto.');
      dependency.dependsOn.forEach(child => visit(child, seen));
    };
    task.dependsOn.forEach(next => visit(next, new Set()));
  }

  create(project: { id: string; path: string }, raw: unknown): Promise<ProjectTask> {
    const body = object(raw); const taskId = id(body.id); const fields = draft(body);
    return this.mutate(tasks => {
      const existing = tasks.find(t => t.id === taskId);
      if (existing) {
        if (existing.projectId === project.id && Object.entries(fields).every(([key, value]) => JSON.stringify(existing[key as keyof ProjectTask]) === JSON.stringify(value))) return existing;
        throw new TaskError(409, 'Já existe uma tarefa diferente com esse identificador.');
      }
      if (tasks.length >= 2000) throw new TaskError(409, 'O limite de tarefas foi atingido.');
      const at = this.now();
      const task: ProjectTask = { ...fields, id: taskId, projectId: project.id, projectPath: project.path, reviews: [], version: 1, createdAt: at, updatedAt: at };
      this.dependencies(tasks, task); tasks.push(task); return task;
    });
  }

  private current(tasks: ProjectTask[], taskId: string, version: unknown): ProjectTask {
    const task = tasks.find(t => t.id === taskId);
    if (!task) throw new TaskError(404, 'Tarefa não encontrada.');
    if (!Number.isSafeInteger(version) || task.version !== version) throw new TaskError(409, 'Esta tarefa mudou em outra página. Atualize a lista antes de salvar.');
    return task;
  }
  update(taskId: string, raw: unknown): Promise<ProjectTask> {
    const body = object(raw); const fields = draft(body);
    return this.mutate(tasks => {
      const task = this.current(tasks, taskId, body.version);
      const next = { ...task, ...fields };
      this.dependencies(tasks, next);
      Object.assign(task, next, { version: task.version + 1, updatedAt: this.now() }); return task;
    });
  }

  review(taskId: string, raw: unknown, deliveries: () => Promise<DeliveryInfo[]>): Promise<ProjectTask> {
    const body = object(raw); const reviewId = id(body.id);
    if (!['accepted', 'changes_requested'].includes(body.verdict as string)) invalid();
    const note = string(body.note, 4000, body.verdict === 'changes_requested');
    const checked = strings(body.criteria, 30, 300);
    return this.mutate(async tasks => {
      const existing = tasks.find(t => t.id === taskId);
      const previous = existing?.reviews.find(r => r.id === reviewId);
      if (previous) {
        if (previous.verdict === body.verdict && previous.note === note && previous.delivery.id === body.deliveryId
          && previous.delivery.fingerprint === body.fingerprint && JSON.stringify(previous.criteria) === JSON.stringify(checked)) return existing!;
        throw new TaskError(409, 'Revisão já registrada com conteúdo diferente.');
      }
      const task = this.current(tasks, taskId, body.version);
      if (task.reviews.length >= 1000) throw new TaskError(409, 'O limite de revisões desta tarefa foi atingido.');
      if (checked.some(c => !task.criteria.includes(c))) invalid('Os critérios mudaram. Atualize a tarefa.');
      if (body.verdict === 'accepted' && (task.criteria.some(c => !checked.includes(c)) || task.dependsOn.some(dep => tasks.find(t => t.id === dep)?.status !== 'done'))) {
        throw new TaskError(409, 'Confira todos os critérios e conclua as dependências antes de aprovar.');
      }
      const delivery = (await deliveries()).find(d => d.id === body.deliveryId && d.project && projectPathKey(d.project) === projectPathKey(task.projectPath));
      if (!delivery) throw new TaskError(409, 'A entrega não está mais disponível para este projeto. Atualize as entregas.');
      const ref = taskDelivery(delivery);
      if (ref.fingerprint !== body.fingerprint) throw new TaskError(409, 'A entrega mudou. Abra a versão atual antes de revisar.');
      const review: TaskReview = { id: reviewId, at: this.now(), verdict: body.verdict as TaskReview['verdict'], note, criteria: checked, delivery: ref };
      task.reviews.push(review); task.status = review.verdict === 'accepted' ? 'done' : 'doing';
      task.version++; task.updatedAt = review.at; return task;
    });
  }
}
