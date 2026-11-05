import { taskStatusLabels, type ProjectTask, type TaskDelivery, type TaskDraft } from '../../../shared/project-tasks';
import type { RoomInfo } from '../../../shared/types';
import { h } from './dom';

const button = (text: string, click: () => void) => h('button', { type: 'button', class: 'ui-btn', text, on: { click } });
const message = (text: string) => h('p', { class: 'ui-work__muted', text });
let fieldId = 0;
function field(label: string, input: HTMLElement): HTMLElement {
  const id = `ui-task-field-${++fieldId}`;
  input.setAttribute('aria-labelledby', id);
  return h('label', { class: 'ui-work-tasks__field' }, h('span', { text: label, attrs: { id } }), input);
}
function select(options: [string, string][], value: string): HTMLSelectElement {
  const el = h('select', { class: 'ui-work__select' }, ...options.map(([key, label]) => h('option', { text: label, attrs: { value: key } })));
  el.value = value; return el;
}

/** Deliberate manual work. No task or review operation sends a message to an agent. */
export class WorkTasks {
  readonly el = h('section', { class: 'ui-work-tasks', hidden: true, attrs: { 'aria-label': 'Tarefas persistentes' } });
  private status = h('p', { role: 'status', attrs: { 'aria-live': 'polite' } });
  private list = h('div', { class: 'ui-work__list' });
  private editor = h('div', { class: 'ui-work-tasks__editor' });
  private create = button('Nova tarefa', () => this.edit());
  private refresh = button('Atualizar lista', () => void this.load());
  private tasks: ProjectTask[] = [];
  private rooms: RoomInfo[] = [];
  private projectId = '';
  private available = false;
  private loaded = false;
  private busy = false;
  private request: AbortController | null = null;
  private reviewRequest: AbortController | null = null;
  private draftProject = '';

  constructor(private readonly preview: (id: string) => void) {
    this.el.append(message('Tarefas salvas por projeto, independentes das sessões. Conclua cada uma após revisar a entrega.'),
      h('div', { class: 'ui-work__actions' }, this.create, this.refresh), this.status, this.editor, this.list);
  }

  update(projectId: string, rooms: RoomInfo[], active: boolean, available: boolean): void {
    const changed = this.projectId !== projectId;
    this.projectId = projectId; this.rooms = rooms;
    this.el.hidden = !active;
    if (this.available !== available) {
      this.available = available;
      if (!available) {
        this.request?.abort(); this.request = null; this.reviewRequest?.abort(); this.reviewRequest = null;
        this.tasks = []; this.loaded = false; this.list.replaceChildren();
        // A brief SSE disconnect must not erase an unsaved form. Hidden modes still expose no live task data.
        if (!this.editor.querySelector('.ui-work__card')) this.editor.replaceChildren();
      }
    }
    this.editor.hidden = !available;
    this.create.disabled = !available || !projectId || this.busy;
    this.refresh.disabled = !available || this.busy;
    if (!active) return;
    if (!available) { this.status.textContent = 'Abra o escritório local ao vivo para gerenciar tarefas. Demonstração, reprodução e acesso remoto não alteram tarefas reais.'; return; }
    if (changed && this.draftProject !== projectId) { this.reviewRequest?.abort(); this.editor.replaceChildren(); }
    if (!this.loaded && !this.request) void this.load();
    else if (changed) this.renderList();
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível concluir. Tente novamente.');
    return data as T;
  }
  private async load(): Promise<void> {
    if (!this.available || this.busy) return;
    this.request?.abort(); const request = new AbortController(); this.request = request;
    this.loaded = true;
    this.status.textContent = 'Carregando tarefas…';
    try {
      const data = await this.json<{ tasks: ProjectTask[] }>('/api/project-tasks', { signal: request.signal });
      if (this.request !== request || !this.available) return;
      if (!Array.isArray(data.tasks)) throw new Error('Resposta de tarefas inválida.');
      this.tasks = data.tasks; this.loaded = true; this.renderList();
      this.status.textContent = this.projectId ? 'Tarefas atualizadas. Rascunhos abertos são preservados.' : 'Selecione um projeto para criar uma tarefa.';
    } catch (error) { if (!request.signal.aborted) this.status.textContent = (error as Error).message; }
    finally { if (this.request === request) this.request = null; }
  }
  private renderList(): void {
    const tasks = this.tasks.filter(t => !this.projectId || t.projectId === this.projectId);
    const priority = { low: 'Baixa', normal: 'Normal', high: 'Alta' };
    this.list.replaceChildren(...tasks.map(task => {
      const pending = task.dependsOn.filter(id => this.tasks.find(t => t.id === id)?.status !== 'done').length;
      const latest = task.reviews.at(-1);
      return h('article', { class: 'ui-work__card', attrs: { 'data-task-id': task.id } },
        h('h3', { text: task.title }), message(`${taskStatusLabels[task.status]} · Prioridade ${priority[task.priority]}${task.owner ? ` · ${task.owner}` : ''}`),
        ...(!this.projectId ? [message(this.rooms.find(r => r.id === task.projectId)?.name ?? task.projectPath)] : []),
        ...(pending ? [message(`${pending} dependência(s) ainda aberta(s).`)] : []),
        ...(latest ? [message(`Última revisão: ${latest.verdict === 'accepted' ? 'aprovada' : 'ajustes solicitados'} · ${new Date(latest.at).toLocaleString()}`)] : []),
        h('div', { class: 'ui-work__actions' }, button('Editar tarefa', () => this.edit(task)), button('Revisar entrega', () => void this.review(task))));
    }));
    if (!tasks.length) this.list.append(message('Nenhuma tarefa salva neste recorte.'));
  }

  private edit(task?: ProjectTask): void {
    if (!this.available || this.busy) return;
    const projectId = task?.projectId ?? this.projectId; if (!projectId) return;
    this.reviewRequest?.abort(); this.draftProject = projectId;
    const title = h('input', { type: 'text', class: 'ui-work__select', attrs: { required: '', maxlength: '180' } }); title.value = task?.title ?? '';
    const description = h('textarea', { class: 'ui-work__select', attrs: { rows: '3', maxlength: '6000' } }); description.value = task?.description ?? '';
    const owner = h('input', { type: 'text', class: 'ui-work__select', attrs: { maxlength: '120', placeholder: 'Pessoa ou agente responsável' } }); owner.value = task?.owner ?? '';
    const priority = select([['low', 'Baixa'], ['normal', 'Normal'], ['high', 'Alta']], task?.priority ?? 'normal');
    const status = select(Object.entries(taskStatusLabels).filter(([key]) => key !== 'done'), task?.status === 'done' ? 'review' : task?.status ?? 'todo');
    const criteria = h('textarea', { class: 'ui-work__select', attrs: { rows: '3', maxlength: '9030', placeholder: 'Um critério por linha' } }); criteria.value = task?.criteria.join('\n') ?? '';
    const deps = h('fieldset', {}, h('legend', { text: 'Depende de' }));
    const dependencies: [string, HTMLInputElement][] = this.tasks.filter(t => t.projectId === projectId && t.id !== task?.id).map(t => {
      const input = h('input', { type: 'checkbox', attrs: { checked: task?.dependsOn.includes(t.id) ?? false } });
      deps.append(h('label', { class: 'ui-work-tasks__check' }, input, h('span', { text: `${t.title} · ${taskStatusLabels[t.status]}` }))); return [t.id, input];
    });
    if (!dependencies.length) deps.append(message('Sem outras tarefas neste projeto.'));
    const error = h('p', { role: 'alert' });
    const save = h('button', { type: 'submit', class: 'ui-btn', text: 'Salvar tarefa' });
    const cancel = button('Fechar edição', () => this.editor.replaceChildren());
    const form = h('form', { class: 'ui-work__card' }, h('h3', { text: task ? 'Editar tarefa' : 'Nova tarefa' }),
      ...(task?.status === 'done' ? [message('Salvar alterações reabre esta tarefa para revisão. As aprovações anteriores permanecem no histórico.')] : []),
      field('Título', title), field('Descrição', description), field('Responsável', owner),
      h('div', { class: 'ui-work-tasks__columns' }, field('Prioridade', priority), field('Situação', status)), field('Critérios de aceite', criteria), deps, error,
      h('div', { class: 'ui-work__actions' }, save, cancel, ...(task ? [button('Recarregar tarefa salva', () => { const current = this.tasks.find(t => t.id === task.id); if (current) this.edit(current); })] : [])));
    const taskId = task?.id ?? crypto.randomUUID();
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!this.available || this.busy) return;
      const fields: TaskDraft = { title: title.value, description: description.value, owner: owner.value, priority: priority.value as TaskDraft['priority'], status: status.value as TaskDraft['status'], criteria: criteria.value.split('\n').map(s => s.trim()).filter(Boolean), dependsOn: dependencies.filter(([, input]) => input.checked).map(([id]) => id) };
      void this.save(task ? `/api/project-tasks/${task.id}` : '/api/project-tasks', task ? 'PATCH' : 'POST', { ...fields, id: taskId, projectId, version: task?.version }, form, error);
    });
    this.editor.replaceChildren(form); title.focus();
  }

  private async save(url: string, method: string, body: unknown, form: HTMLElement, error: HTMLElement): Promise<void> {
    if (!this.available || this.busy) return;
    this.busy = true; error.textContent = ''; this.status.textContent = 'Salvando…';
    const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('input,button,select,textarea')];
    const disabled = controls.map(control => control.disabled); controls.forEach(control => { control.disabled = true; });
    this.create.disabled = true; this.refresh.disabled = true;
    try {
      const result = await this.json<{ task: ProjectTask }>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!this.available) return;
      this.tasks = [...this.tasks.filter(t => t.id !== result.task.id), result.task]; this.renderList();
      this.editor.replaceChildren(); this.status.textContent = method === 'POST' && url.endsWith('/reviews') ? 'Revisão registrada.' : 'Tarefa salva.';
      this.refresh.focus({ preventScroll: true });
    } catch (err) { if (this.available) { error.textContent = (err as Error).message; this.status.textContent = 'Não foi possível salvar. Seu rascunho foi preservado.'; } }
    finally {
      this.busy = false; controls.forEach((control, i) => { control.disabled = disabled[i]; });
      this.create.disabled = !this.available || !this.projectId; this.refresh.disabled = !this.available;
    }
  }

  private async review(task: ProjectTask): Promise<void> {
    if (!this.available || this.busy) return;
    this.reviewRequest?.abort(); const request = new AbortController(); this.reviewRequest = request;
    this.draftProject = task.projectId;
    this.editor.replaceChildren(message('Carregando entregas do projeto…'));
    try {
      const { deliveries } = await this.json<{ deliveries: TaskDelivery[] }>(`/api/project-tasks/${task.id}/deliveries`, { signal: request.signal });
      if (request.signal.aborted || !this.available) return;
      if (!Array.isArray(deliveries)) throw new Error('Resposta de entregas inválida.');
      const choices = select([['', 'Selecione uma entrega'], ...deliveries.map(d => [d.id, `${d.headline} · ${new Date(d.finishedAt).toLocaleString()}`] as [string, string])], '');
      const open = button('Abrir entrega selecionada', () => { if (choices.value) this.preview(choices.value); });
      open.disabled = true; choices.addEventListener('change', () => { open.disabled = !choices.value; });
      const checkboxes = task.criteria.map(text => ({ text, input: h('input', { type: 'checkbox' }) }));
      const note = h('textarea', { class: 'ui-work__select', attrs: { rows: '3', maxlength: '4000' } });
      const error = h('p', { role: 'alert' });
      const form = h('div', { class: 'ui-work__card' }, h('h3', { text: `Revisar: ${task.title}` }),
        message('Confira o conteúdo e os arquivos da entrega antes de registrar sua decisão.'),
        ...(deliveries.length ? [field('Entrega', choices), open] : [message('Nenhuma entrega disponível neste projeto. Use Atualizar entregas após o agente concluir um pedido.')]),
        h('fieldset', {}, h('legend', { text: 'Critérios conferidos' }),
          ...checkboxes.map(({ text, input }) => h('label', { class: 'ui-work-tasks__check' }, input, h('span', { text }))),
          ...(!checkboxes.length ? [message('Esta tarefa não tem critérios definidos. Sua aprovação será uma confirmação manual da entrega.')] : [])),
        field('Observações da revisão', note), error);
      const reviewId = crypto.randomUUID();
      const submit = (verdict: 'accepted' | 'changes_requested') => {
        const delivery = deliveries.find(d => d.id === choices.value);
        if (!delivery) { error.textContent = 'Selecione a entrega que você conferiu.'; choices.focus(); return; }
        if (verdict === 'changes_requested' && !note.value.trim()) { error.textContent = 'Descreva os ajustes necessários.'; note.focus(); return; }
        void this.save(`/api/project-tasks/${task.id}/reviews`, 'POST', { id: reviewId, version: task.version, verdict, note: note.value, criteria: checkboxes.filter(c => c.input.checked).map(c => c.text), deliveryId: delivery.id, fingerprint: delivery.fingerprint }, form, error);
      };
      form.append(h('div', { class: 'ui-work__actions' }, button('Aprovar e concluir', () => submit('accepted')), button('Pedir ajustes', () => submit('changes_requested')),
        button('Atualizar entregas', () => void this.review(this.tasks.find(t => t.id === task.id) ?? task)), button('Fechar revisão', () => this.editor.replaceChildren())));
      if (task.reviews.length) {
        const history = h('details', {}, h('summary', { text: `Histórico de revisões (${task.reviews.length})` }));
        for (const review of [...task.reviews].reverse()) history.append(h('div', { class: 'ui-work-tasks__review' },
          h('strong', { text: `${review.verdict === 'accepted' ? 'Aprovada' : 'Ajustes solicitados'} · ${new Date(review.at).toLocaleString()}` }),
          message(review.delivery.headline), message(review.note || 'Sem observações.'), message(`Critérios conferidos: ${review.criteria.join('; ') || 'nenhum definido'}`)));
        form.append(history);
      }
      this.editor.replaceChildren(form); choices.focus();
    } catch (err) { if (!request.signal.aborted && this.available) this.editor.replaceChildren(message((err as Error).message), button('Tentar novamente', () => void this.review(task))); }
    finally { if (this.reviewRequest === request) this.reviewRequest = null; }
  }
}
