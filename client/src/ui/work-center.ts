import type { DeliveryInfo, OfficeSnapshot } from '../../../shared/types';
import { access } from '../net/access';
import type { UiComponent, UiContext } from './context';
import { parseDeliveries } from './deliveries';
import { h, setAttr, setText } from './dom';
import { relativeTime } from './format';
import { statusLabel } from './model';
import { focusPermission } from './permission';
import { collectWorkAttention, summarizeWorkProject, workIntegrations, workText, type WorkAttention } from './work-center-model';
import { WorkTemplates } from './work-templates';
import { WorkTasks } from './work-tasks';
import './work-center.css';

type Tab = 'summary' | 'tasks' | 'attention' | 'templates' | 'integrations';
interface WorkCenterActions { history(): void; delivery(id: string): void; }
const tabs: readonly [Tab, string][] = [['summary', 'Projetos'], ['tasks', 'Tarefas'], ['attention', 'Precisa de você'], ['templates', 'Modelos de tarefa'], ['integrations', 'Integrações']];
const kindLabel = { permission: 'Permissão', question: 'Pergunta', waiting: 'Aguardando ação', error: 'Erro recente' };

/** Overview actions hand off to the existing, guarded UI. */
export class WorkCenter implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLDialogElement;
  private badge = h('span', { class: 'ui-work__badge', hidden: true });
  private roomSelect: HTMLSelectElement;
  private notice = h('p', { class: 'ui-work__notice', role: 'status' });
  private body = h('div', { class: 'ui-work__content' });
  private panel = h('section', { role: 'tabpanel', tabIndex: 0, attrs: { id: 'ui-work-panel' } });
  private templateEditor = new WorkTemplates();
  private taskEditor: WorkTasks;
  private tabButtons = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'summary';
  private roomId = '';
  private roomsKey = '';
  private renderKey = '';
  private opener: HTMLElement | null = null;
  private deliveries: DeliveryInfo[] = [];
  private deliveryState: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable' = 'idle';
  private deliveryRequest: AbortController | null = null;
  private deliveryCompletionKey = '';

  constructor(private readonly ctx: UiContext, private readonly actions: WorkCenterActions) {
    this.taskEditor = new WorkTasks(id => { this.close(false); this.actions.delivery(id); });
    this.button = h('button', { class: 'ui-btn ui-work-launcher', type: 'button', title: 'Central de trabalho',
      attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Central de trabalho' },
      on: { click: () => this.open(this.button) } }, h('span', { text: 'Central de trabalho' }), this.badge);
    const close = h('button', { class: 'ui-icon-btn', type: 'button', text: '×', attrs: { 'aria-label': 'Fechar central de trabalho' }, on: { click: () => this.close() } });
    const nav = h('div', { class: 'ui-work__tabs', role: 'tablist', attrs: { 'aria-label': 'Seções da central' } });
    for (const [id, label] of tabs) {
      const button = h('button', { class: 'ui-work__tab', type: 'button', role: 'tab', text: label,
        attrs: { id: `ui-work-tab-${id}`, 'aria-controls': 'ui-work-panel' }, on: { click: () => this.chooseTab(id), keydown: event => {
          const e = event as KeyboardEvent;
          const index = tabs.findIndex(([key]) => key === id);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
          if (next < 0) return;
          e.preventDefault(); this.chooseTab(tabs[next][0]); this.tabButtons.get(tabs[next][0])?.focus();
        } } });
      this.tabButtons.set(id, button); nav.append(button);
    }
    this.roomSelect = h('select', { class: 'ui-work__select', attrs: { id: 'ui-work-project' }, on: { change: () => {
      this.roomId = this.roomSelect.value; this.renderKey = ''; this.render();
    } } });
    this.panel.append(this.body, this.templateEditor.el, this.taskEditor.el);
    this.el = h('dialog', { class: 'ui-work', attrs: { 'aria-labelledby': 'ui-work-title' } },
      h('header', { class: 'ui-work__header' }, h('div', {}, h('h2', { text: 'Central de trabalho', attrs: { id: 'ui-work-title' } }),
        h('p', { text: 'Acompanhe seus projetos e encontre o próximo passo.' })), close), nav,
      h('div', { class: 'ui-work__scope' }, h('label', { text: 'Projeto', attrs: { for: 'ui-work-project' } }), this.roomSelect), this.notice, this.panel);
    this.el.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    // Keep office shortcuts from acting behind the modal; native Tab/Escape still work.
    this.el.addEventListener('keydown', event => event.stopPropagation());
    this.el.addEventListener('close', () => {
      this.cancelDeliveries(); this.deliveries = []; this.deliveryState = 'idle'; this.deliveryCompletionKey = ''; this.renderKey = '';
      setAttr(this.button, 'aria-expanded', 'false'); this.button.classList.remove('is-on');
    });
    this.chooseTab('summary');
  }

  open(opener: HTMLElement = this.button): void {
    if (this.el.open) return;
    this.opener = opener;
    const selection = this.ctx.selection();
    if (selection?.type === 'room') this.roomId = selection.id;
    else if (selection?.type === 'agent') this.roomId = this.ctx.agent(selection.id)?.roomId ?? this.roomId;
    this.renderKey = ''; this.el.showModal();
    setAttr(this.button, 'aria-expanded', 'true'); this.button.classList.add('is-on');
    this.render(); this.tabButtons.get(this.tab)?.focus();
  }

  private close(restoreFocus = true): void {
    this.cancelDeliveries(); this.el.close();
    if (restoreFocus && this.opener?.isConnected) this.opener.focus();
  }

  private chooseTab(tab: Tab): void {
    const moveFocus = this.el?.open && this.body.contains(document.activeElement);
    this.tab = tab;
    for (const [id, button] of this.tabButtons) {
      setAttr(button, 'aria-selected', String(id === tab)); button.tabIndex = id === tab ? 0 : -1;
    }
    setAttr(this.panel, 'aria-labelledby', `ui-work-tab-${tab}`);
    this.body.hidden = tab === 'templates' || tab === 'tasks'; this.templateEditor.el.hidden = tab !== 'templates';
    this.taskEditor.el.hidden = tab !== 'tasks';
    this.renderKey = ''; if (this.el?.open) this.render();
    if (moveFocus) this.tabButtons.get(tab)?.focus();
  }

  render(): void {
    const snapshot = this.ctx.store.snapshot;
    this.taskEditor.update(this.roomId, snapshot?.rooms ?? [], this.el.open && this.tab === 'tasks',
      !!snapshot && !!access().projectTasks && this.ctx.store.connection === 'open' && !this.ctx.store.replaying && !snapshot.meta.demo && !this.ctx.store.mock);
    const now = this.ctx.now();
    const attention = snapshot ? collectWorkAttention(snapshot.agents, now) : [];
    setText(this.badge, String(attention.length)); this.badge.hidden = !attention.length;
    setAttr(this.button, 'aria-label', attention.length ? `Central de trabalho: ${attention.length} item(ns) para conferir` : 'Central de trabalho');
    if (!this.el.open) return;
    if (!snapshot) { this.notice.textContent = 'Aguardando os dados do escritório…'; this.replaceBody([this.empty('Os projetos aparecerão quando a conexão estiver pronta.')]); return; }
    const rooms = snapshot.rooms;
    if (!rooms.some(r => r.id === this.roomId)) this.roomId = '';
    const roomKey = JSON.stringify(rooms.map(r => [r.id, r.name]));
    if (roomKey !== this.roomsKey) {
      this.roomsKey = roomKey;
      this.roomSelect.replaceChildren(h('option', { text: 'Todos os projetos', attrs: { value: '' } }),
        ...rooms.map(room => h('option', { text: room.name, attrs: { value: room.id } })));
    }
    this.roomSelect.value = this.roomId;
    const room = rooms.find(r => r.id === this.roomId);
    this.roomSelect.disabled = this.tab === 'integrations';
    this.templateEditor.setProject(room ? `${room.name}\nPasta: ${room.path}` : '');
    const replaying = this.ctx.store.replaying;
    const connected = this.ctx.store.connection === 'open';
    setText(this.notice, replaying ? 'Reprodução histórica. Os registros abaixo pertencem ao instante selecionado.'
      : snapshot.meta.demo || this.ctx.store.mock ? 'Demonstração com dados fictícios.'
      : !connected ? 'Conexão interrompida ou reconectando. Exibindo os últimos dados recebidos.'
      : this.tab === 'integrations' ? 'Estado observado nesta página. Uma fonte sem sessões não significa desconexão.'
      : room ? `Projeto: ${room.name}` : `${rooms.length} projeto(s) · visão de todo o escritório`);
    const canRead = connected && !replaying && !snapshot.meta.demo && !this.ctx.store.mock && access().terminal && !!snapshot.meta.terminal;
    if (!canRead) {
      this.cancelDeliveries(); this.deliveries = []; this.deliveryState = 'unavailable';
    } else if (this.tab === 'summary') {
      const completionKey = JSON.stringify(snapshot.agents.map(agent => [agent.id,
        agent.recent.filter(activity => activity.kind === 'done').map(activity => activity.id),
        agent.activity?.kind === 'done' ? agent.activity.id : null]));
      if (this.deliveryState === 'idle' || this.deliveryState === 'unavailable'
        || (this.deliveryState === 'ready' && completionKey !== this.deliveryCompletionKey)) {
        this.deliveryCompletionKey = completionKey; void this.loadDeliveries();
      }
    }
    if (this.tab === 'templates' || this.tab === 'tasks') return;
    const key = JSON.stringify([this.tab, this.roomId, snapshot, access(), replaying, connected, attention.map(item => item.id), Math.floor(now / 60_000), this.deliveryState, this.deliveries.map(d => [d.id, d.finishedAt])]);
    if (key === this.renderKey) return;
    this.renderKey = key;
    if (this.tab === 'attention') this.renderAttention(this.roomId ? attention.filter(item => item.agent.roomId === this.roomId) : attention, snapshot);
    else if (this.tab === 'integrations') this.renderIntegrations(snapshot, connected);
    else this.renderSummary(snapshot);
  }

  private action(label: string, key: string, callback: () => void): HTMLButtonElement {
    return h('button', { class: 'ui-btn', type: 'button', text: label, attrs: { 'data-work-key': key }, on: { click: callback } });
  }
  private empty(text: string): HTMLElement { return h('p', { class: 'ui-work__empty', text }); }
  private metric(label: string, value: number): HTMLElement {
    return h('div', { class: 'ui-work__metric' }, h('strong', { text: String(value) }), h('span', { text: label }));
  }
  private openAgent(id: string, permission = false): void {
    const agent = this.ctx.agent(id); if (!agent) { this.renderKey = ''; this.render(); return; }
    this.close(false);
    if (permission && !this.ctx.store.replaying && agent.permission && agent.permission.expiresAt > this.ctx.now()) focusPermission(this.ctx, id);
    else this.ctx.select({ type: 'agent', id }, { focus: true });
  }
  private replaceBody(children: HTMLElement[]): void {
    const focused = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement) ? document.activeElement.dataset.workKey : undefined;
    this.body.replaceChildren(...children);
    if (focused) [...this.body.querySelectorAll<HTMLElement>('[data-work-key]')].find(el => el.dataset.workKey === focused)?.focus({ preventScroll: true });
  }

  private renderAttention(items: WorkAttention[], snapshot: OfficeSnapshot): void {
    const intro = h('p', { class: 'ui-work__muted', text: 'Permissões e perguntas primeiro, depois esperas e erros dos últimos 10 minutos. Os pedidos mais antigos aparecem primeiro em cada grupo.' });
    if (!items.length) { this.replaceBody([intro, this.empty('Nenhuma pendência observada neste recorte.')]); return; }
    const list = h('ol', { class: 'ui-work__list' });
    for (const item of items) {
      const room = snapshot.rooms.find(r => r.id === item.agent.roomId);
      const native = item.kind === 'question' && !item.permission;
      list.append(h('li', { class: `ui-work__item ui-work__item--${item.kind}` },
        h('div', { class: 'ui-work__item-head' }, h('strong', { text: kindLabel[item.kind] }), h('span', { text: relativeTime(item.since, this.ctx.now()) })),
        h('p', { class: 'ui-work__reason', text: item.text }),
        h('p', { class: 'ui-work__muted', text: `${room?.name ?? 'Projeto'} · ${item.agent.name}${native ? ' · Resposta no cartão original do cliente' : ''}` }),
        this.action(item.permission ? 'Abrir pedido' : 'Ver sessão', item.id, () => this.openAgent(item.agent.id, item.permission))));
    }
    this.replaceBody([intro, list]);
  }

  private renderSummary(snapshot: OfficeSnapshot): void {
    const room = snapshot.rooms.find(r => r.id === this.roomId);
    if (!room) {
      if (!snapshot.rooms.length) {
        const nodes = [this.empty('Nenhum projeto registrado ou observado ainda.')];
        if (access().projects && !this.ctx.store.replaying) nodes.push(this.action('Adicionar projeto', 'add-project', () => { this.close(false); this.ctx.openProject?.(this.button); }));
        this.replaceBody(nodes); return;
      }
      const list = h('div', { class: 'ui-work__projects' });
      for (const project of snapshot.rooms) {
        const summary = summarizeWorkProject(snapshot, project.id, this.ctx.now());
        list.append(h('article', { class: 'ui-work__card' }, h('h3', { text: project.name }),
          h('p', { class: 'ui-work__path', text: project.path }),
          h('p', { text: `${summary.sessions} sessão(ões) · ${summary.working} em atividade · ${summary.attention.length} pendência(s)` }),
          h('p', { class: 'ui-work__muted', text: summary.objective?.text ?? 'Nenhum objetivo registrado em uma sessão ativa.' }),
          this.action('Ver projeto', `project:${project.id}`, () => { this.roomId = project.id; this.renderKey = ''; this.render(); })));
      }
      this.replaceBody([list]); return;
    }
    const summary = summarizeWorkProject(snapshot, room.id, this.ctx.now());
    const stats = h('div', { class: 'ui-work__metrics' }, this.metric('Sessões', summary.sessions), this.metric('Em atividade', summary.working),
      this.metric('Pendências', summary.attention.length), this.metric('Tarefas registradas', summary.tasks.length));
    const overview = h('article', { class: 'ui-work__card' }, h('h3', { text: room.name }), h('p', { class: 'ui-work__path', text: room.path }), stats,
      h('h4', { text: summary.objective?.label ?? 'Objetivo atual' }), h('p', { text: summary.objective?.text ?? 'Sem objetivo registrado. Escolha um modelo para preparar a próxima tarefa.' }),
      h('h4', { text: 'Próximo passo registrado' }),
      h('p', { text: summary.attention[0]?.text ?? (summary.nextTask ? workText(summary.nextTask.task.title) : 'Nenhuma pendência ou tarefa em aberto registrada.') }));
    const history = this.action('Histórico de sessões', 'history', () => { this.close(false); this.actions.history(); });
    history.disabled = !access().terminal || !snapshot.meta.terminal || this.ctx.store.mock || this.ctx.store.replaying;
    const actions = h('div', { class: 'ui-work__actions' },
      this.action('Ver pendências', 'attention', () => this.chooseTab('attention')),
      this.action('Preparar tarefa', 'templates', () => this.chooseTab('templates')), history,
      this.action('Ir para a sala', 'room', () => { this.close(false); this.ctx.select({ type: 'room', id: room.id }, { focus: true }); }));
    const sessions = h('section', { class: 'ui-work__card' }, h('h3', { text: 'Sessões do projeto' }));
    if (!summary.agents.length) sessions.append(this.empty('A sala está registrada e não tem sessões observadas agora.'));
    for (const agent of summary.agents) sessions.append(h('div', { class: 'ui-work__session' },
      h('div', {}, h('strong', { text: agent.name }), h('span', { class: 'ui-work__muted', text: ` · ${agent.kind === 'sub' ? 'Subagente · ' : ''}${statusLabel(agent.status)}` })),
      this.action('Abrir sessão', `agent:${agent.id}`, () => this.openAgent(agent.id))));
    const delivery = this.deliveries.filter(d => d.project && normalizePath(d.project) === normalizePath(room.path)).sort((a, b) => b.finishedAt - a.finishedAt)[0];
    const last = h('section', { class: 'ui-work__card' }, h('h3', { text: 'Última entrega' }));
    if (delivery) last.append(h('p', { text: workText(delivery.headline) }), h('p', { class: 'ui-work__muted', text: `${relativeTime(delivery.finishedAt, this.ctx.now())} · Resposta registrada, sem validação automática do resultado.` }),
      this.action('Abrir entrega', `delivery:${delivery.id}`, () => { this.close(false); this.actions.delivery(delivery.id); }));
    else last.append(h('p', { class: 'ui-work__muted', text: this.deliveryState === 'loading' ? 'Consultando entregas…'
      : this.deliveryState === 'error' ? 'Não foi possível consultar as entregas.' : this.deliveryState === 'unavailable' ? 'Entregas não disponíveis neste modo ou acesso.' : 'Nenhuma entrega deste projeto nos últimos 7 dias.' }));
    if (this.deliveryState === 'error') last.append(this.action('Tentar novamente', 'retry-deliveries', () => void this.loadDeliveries()));
    if (summary.latest) last.append(h('h4', { text: 'Último turno concluído' }), h('p', { text: `${summary.latest.agent.name} · ${relativeTime(summary.latest.activity.at, this.ctx.now())}. Este registro não comprova testes ou aprovação da entrega.` }));
    this.replaceBody([overview, actions, sessions, last]);
  }

  private renderIntegrations(snapshot: OfficeSnapshot, connected: boolean): void {
    const nodes = workIntegrations(snapshot, access(), this.ctx.store.replaying, connected, this.ctx.now()).map(integration => {
      const list = h('dl', { class: 'ui-work__capabilities' });
      for (const capability of integration.capabilities) list.append(h('dt', { text: capability.label }), h('dd', { text: capability.value }));
      return h('article', { class: 'ui-work__card' }, h('h3', { text: integration.title }), h('p', { text: integration.state }), list,
        ...integration.details.map(text => h('p', { class: 'ui-work__muted', text })),
        h('p', { class: 'ui-work__muted', text: integration.provider === 'codex'
          ? 'Perguntas nativas continuam no cartão original do Codex. Pedidos pelo canal direto do Dissero abrem o próprio cartão de resposta.'
          : 'Mensagens e aprovações dependem dos canais conectados à sessão. Uma fonte legível não comprova esses canais.' }));
    });
    nodes.push(h('p', { class: 'ui-work__muted', text: 'O diagnóstico acompanha os dados recebidos. Abra a sessão para conferir e usar os canais disponíveis.' }));
    this.replaceBody(nodes);
  }

  private cancelDeliveries(): void { this.deliveryRequest?.abort(); this.deliveryRequest = null; }
  private async loadDeliveries(): Promise<void> {
    if (!this.el.open || this.ctx.store.replaying || this.ctx.store.mock || this.ctx.store.snapshot?.meta.demo
      || this.ctx.store.connection !== 'open' || !access().terminal || !this.ctx.store.snapshot?.meta.terminal) return;
    this.cancelDeliveries();
    const controller = new AbortController(); this.deliveryRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    this.deliveryState = 'loading'; this.renderKey = ''; this.ctx.invalidate();
    try {
      const response = await fetch('/api/deliveries', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Delivery request failed');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('deliveries' in body) || !Array.isArray(body.deliveries)) throw new Error('Invalid delivery response');
      if (this.deliveryRequest !== controller || !this.el.open) return;
      if (this.ctx.store.replaying || !access().terminal || this.ctx.store.connection !== 'open' || !this.ctx.store.snapshot?.meta.terminal) {
        this.deliveries = []; this.deliveryState = 'unavailable'; return;
      }
      this.deliveries = parseDeliveries(body); this.deliveryState = 'ready';
    } catch {
      if (this.deliveryRequest !== controller || !this.el.open) return;
      this.deliveries = []; this.deliveryState = 'error';
    } finally {
      clearTimeout(timeout);
      if (this.deliveryRequest === controller) { this.deliveryRequest = null; this.renderKey = ''; this.ctx.invalidate(); }
    }
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}
