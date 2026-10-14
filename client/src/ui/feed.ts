// Feed de atividade (painel inferior recolhível): últimos eventos do escritório, do mais antigo ao mais recente.
import { partsKey } from '../../../shared/appearance';
import type { AgentInfo, FeedItem } from '../../../shared/types';
import { activityDisplayText, groupFeedItems, isImportantFeedItem, sanitizeActivityText, type FeedDisplayRow } from './feed-policy';
import { createAvatar, createAvatarPlaceholder, updateAvatar } from './avatar';
import type { UiComponent, UiContext } from './context';
import { h, KeyedList, setAttr, setHidden, setText, setTitle } from './dom';
import { formatClock } from './format';
import { ICONS } from './icons';
import { shellDoneKind } from './model';
import { officeIsEmpty } from './overlays';
import { createAccountChip, updateAccountChip } from './widgets';
import { tr } from '../../../shared/i18n';

const VISIBLE = 50;

type AgentMeta = Pick<AgentInfo, 'seed' | 'look' | 'kind' | 'account' | 'parts'>;

export type FeedMode = 'important' | 'all';
export type FeedScope = { type: 'all' } | { type: 'project'; id: string } | { type: 'agent'; id: string };
interface FeedScopeOption { value: string; scope: FeedScope; label: string; }

function scopeValue(scope: FeedScope): string {
  return scope.type === 'all' ? 'all' : `${scope.type}:${scope.id}`;
}

export class FeedPanel implements UiComponent {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private rows: KeyedList<FeedDisplayRow>;
  private items: FeedItem[] = [];
  private important: FeedItem[] = [];
  private pendingImportant: FeedItem[] = [];
  private pending: FeedItem[] = [];
  private pendingCounts = new Map<string | undefined, number>();
  private hovering = false;
  private scrolledUp = false;
  private newPill: HTMLButtonElement;
  private ticker: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private empty: HTMLElement;
  private filterNote: HTMLElement;
  private scopeSelect: HTMLSelectElement;
  private modeButtons = new Map<FeedMode, HTMLButtonElement>();
  private scope: FeedScope = { type: 'all' };
  private scopeOptions: FeedScopeOption[] = [];
  private scopeOptionSignature = '';
  /** Aparência/conta dos agentes com eventos guardados (o feed sobrevive à saída do agente). */
  private meta = new Map<string, AgentMeta>();

  constructor(private ctx: UiContext) {
    this.list = h('ol', { class: 'ui-feed__list', role: 'log', attrs: { 'aria-label': tr('Eventos recentes'), 'aria-live': 'off' } });
    this.rows = new KeyedList<FeedDisplayRow>(this.list, {
      key: (row) => row.id,
      create: (row) => this.createRow(row),
      update: (li, row) => this.updateRow(li, row),
    });
    this.empty = h('p', { class: 'ui-feed__empty', text: tr('Os eventos dos agentes aparecem aqui assim que acontecem.') });
    this.newPill = h('button', { class: 'ui-feed__new', type: 'button', hidden: true, on: { click: () => this.resume() } });
    this.ticker = h('span', { class: 'ui-feed__ticker', attrs: { 'aria-hidden': 'true' } });
    this.filterNote = h('span', { class: 'ui-feed__filter', hidden: true });
    this.toggleBtn = h('button', { class: 'ui-icon-btn ui-icon-btn--sm', type: 'button', on: { click: () => ctx.togglePanel('feed') } });
    const importantBtn = h('button', { class: 'ui-feed__mode-btn', type: 'button', text: tr('Importantes'), attrs: { 'aria-pressed': 'false' }, on: { click: () => this.setMode('important') } });
    const allBtn = h('button', { class: 'ui-feed__mode-btn', type: 'button', text: tr('Tudo'), attrs: { 'aria-pressed': 'false' }, on: { click: () => this.setMode('all') } });
    this.modeButtons.set('important', importantBtn);
    this.modeButtons.set('all', allBtn);
    this.scopeSelect = h('select', { class: 'ui-feed__scope', attrs: { 'aria-label': tr('Escopo do feed') }, on: { change: () => this.setScope(this.scopeSelect.value) } });
    const controls = h(
      'div',
      { class: 'ui-feed__controls', role: 'toolbar', attrs: { 'aria-label': tr('Filtros do feed') } },
      h('div', { class: 'ui-feed__mode', role: 'group', attrs: { 'aria-label': tr('Modo do feed') } }, importantBtn, allBtn),
      this.scopeSelect,
    );
    const scroller = h('div', { class: 'ui-feed__scroll' }, this.list, this.empty);
    scroller.addEventListener('scroll', () => {
      this.scrolledUp = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 24;
      if (!this.scrolledUp && !this.hovering) this.flushSoon();
    });
    this.el = h(
      'section',
      { class: 'ui-panel ui-feed', attrs: { 'aria-label': tr('Feed de atividade'), id: 'ui-feed' } },
      h(
        'div',
        { class: 'ui-feed__head' },
        h('button', { class: 'ui-feed__title', type: 'button', on: { click: () => ctx.togglePanel('feed') } }, h('h2', { text: tr('Atividade') }), this.filterNote, this.ticker),
        this.newPill,
        this.toggleBtn,
      ),
      controls,
      scroller,
    );
    // Pausa a rolagem enquanto o mouse está sobre a lista.
    scroller.addEventListener('mouseenter', () => (this.hovering = true));
    scroller.addEventListener('mouseleave', () => {
      this.hovering = false;
      this.flushSoon();
    });

    ctx.store.on('feed', (fresh) => {
      this.appendPending(fresh);
      ctx.invalidate();
    });
    this.appendPending(ctx.store.feed.slice(-VISIBLE));
    // Partidas e apostas resolvidas no escritório (vida social) entram no feed como eventos locais.
    ctx.world.onSocialEvent?.((e) => {
      const a = ctx.agent(e.agentId);
      if (!a) return;
      this.appendPending([{
        id: e.id,
        agentId: a.id,
        roomId: a.roomId,
        agentName: a.name,
        roomName: e.place,
        account: a.account,
        activity: { id: e.id, kind: 'other', icon: e.icon, text: e.text, at: e.at },
      }]);
      ctx.invalidate();
    });
  }

  render(): void {
    for (const a of this.ctx.store.snapshot?.agents ?? []) {
      const m = this.meta.get(a.id);
      if (!m || m.seed !== a.seed || m.account !== a.account || partsKey(m.parts) !== partsKey(a.parts)) {
        this.meta.set(a.id, { seed: a.seed, look: a.look, kind: a.kind, account: a.account, parts: a.parts });
      }
    }
    this.syncScopeOptions();
    const open = this.ctx.isPanelOpen('feed');
    const paused = this.hovering || this.scrolledUp;
    if (this.pending.length && (!paused || !open)) this.flush();
    this.pruneMeta();

    // Filtro por conta da barra lateral: também vale para o feed.
    const hidden = this.ctx.prefs.hiddenAccounts;
    const filtering = hidden.length > 0;
    const visible = (this.feedMode() === 'important' ? this.important : this.items).filter((f) => this.visible(f));
    const pending = (this.feedMode() === 'important' ? this.pendingImportant : this.pending).filter((f) => this.visible(f));
    let newCount = pending.length;
    if (this.feedMode() === 'all' && this.scope.type === 'all') {
      newCount = 0;
      for (const [account, count] of this.pendingCounts) if (!account || !hidden.includes(account)) newCount += count;
    }
    setHidden(this.newPill, !(paused && newCount > 0 && open));
    if (newCount) setText(this.newPill, newCount === 1 ? tr('1 nova') : tr('{0} novas', [Math.min(newCount, 99)]));
    // Escritório vazio: o cartão central já explica; o feed só mostra o que houver de antes.
    setHidden(this.empty, visible.length > 0 || officeIsEmpty(this.ctx));
    setText(
      this.empty,
      filtering && this.items.length > 0
        ? tr('Nenhum evento das contas selecionadas.')
        : this.feedMode() === 'important' && this.items.length > 0
          ? tr('Nenhum evento importante neste escopo.')
          : this.scope.type !== 'all' && this.items.length > 0
            ? tr('Nenhum evento deste escopo.')
            : tr('Os eventos dos agentes aparecem aqui assim que acontecem.'),
    );
    this.updateControls();
    setHidden(this.filterNote, !filtering);
    if (filtering) {
      const names = hidden.map((id) => this.ctx.account(id)?.name ?? id);
      setText(this.filterNote, 'filtrado');
      setTitle(this.filterNote, tr('Sem {0} (filtro da barra lateral)', [names.join(', ')]));
    }

    const latest = pending[pending.length - 1] ?? visible[visible.length - 1];
    setText(this.ticker, latest ? `${latest.agentName}: ${latest.activity.icon} ${activityDisplayText(latest.activity)}` : '');
    this.toggleBtn.innerHTML = open ? ICONS.chevronDown : ICONS.chevronUp;
    const label = open ? tr('Recolher feed ( ] )') : tr('Abrir feed ( ] )');
    setAttr(this.toggleBtn, 'aria-label', label);
    setTitle(this.toggleBtn, label);
    setAttr(this.toggleBtn, 'aria-expanded', String(open));

    // Contas podem ter mudado de cor/nome (ou o filtro mudou): atualiza as linhas visíveis.
    if (open) this.rows.sync(groupFeedItems(visible.slice(-VISIBLE)));
  }

  /** Conta do evento: a do próprio item (servidor novo) ou a do agente, se já apareceu. */
  private accountOf(f: FeedItem): string | undefined {
    return f.account ?? this.meta.get(f.agentId)?.account ?? this.ctx.agent(f.agentId)?.account;
  }

  private visible(f: FeedItem): boolean {
    const acc = this.accountOf(f);
    if (acc && this.ctx.prefs.hiddenAccounts.includes(acc)) return false;
    if (this.feedMode() === 'important' && !isImportantFeedItem(f)) return false;
    if (this.scope.type === 'project') return f.roomId === this.scope.id;
    if (this.scope.type === 'agent') return f.agentId === this.scope.id;
    return true;
  }

  private feedMode(): FeedMode {
    return this.ctx.prefs.feedMode === 'all' ? 'all' : 'important';
  }

  private setMode(mode: FeedMode): void {
    if (this.feedMode() === mode) return;
    this.ctx.updatePrefs({ feedMode: mode });
    this.ctx.invalidate();
  }

  private updateControls(): void {
    const mode = this.feedMode();
    for (const [candidate, button] of this.modeButtons) setAttr(button, 'aria-pressed', String(candidate === mode));
    const value = scopeValue(this.scope);
    if (this.scopeSelect.value !== value) this.scopeSelect.value = value;
  }

  private syncScopeOptions(): void {
    const options: FeedScopeOption[] = [{ value: 'all', scope: { type: 'all' }, label: tr('Todos') }];
    const selection = this.ctx.selection?.();
    let activeAgent: AgentInfo | undefined;
    let projectId: string | undefined;
    if (selection?.type === 'agent') {
      activeAgent = this.ctx.agent(selection.id);
      projectId = activeAgent?.roomId;
    } else if (selection?.type === 'room') {
      projectId = selection.id;
    }
    const room = projectId ? this.ctx.store.snapshot?.rooms.find((r) => r.id === projectId) : undefined;
    if (room) options.push({ value: scopeValue({ type: 'project', id: room.id }), scope: { type: 'project', id: room.id }, label: tr('Projeto atual: {0}', [room.name]) });
    if (activeAgent) options.push({ value: scopeValue({ type: 'agent', id: activeAgent.id }), scope: { type: 'agent', id: activeAgent.id }, label: tr('Agente atual: {0}', [activeAgent.name]) });
    const signature = options.map((option) => option.value + '|' + option.label).join('\n');
    if (signature !== this.scopeOptionSignature) {
      while (this.scopeSelect.firstChild) this.scopeSelect.firstChild.remove();
      for (const option of options) this.scopeSelect.append(h('option', { attrs: { value: option.value }, text: option.label }));
      this.scopeOptionSignature = signature;
    }
    this.scopeOptions = options;
    if (!options.some((option) => option.value === scopeValue(this.scope))) this.scope = { type: 'all' };
  }

  private setScope(value: string): void {
    this.scope = this.scopeOptions.find((option) => option.value === value)?.scope ?? { type: 'all' };
    this.ctx.invalidate();
  }

  private appendPending(fresh: FeedItem[]): void {
    this.pendingImportant = [...this.pendingImportant, ...fresh.filter(isImportantFeedItem)].slice(-VISIBLE);

    // A contagem por conta sobrevive ao descarte das pendências mais antigas.
    for (const f of fresh) {
      const account = this.accountOf(f);
      this.pendingCounts.set(account, (this.pendingCounts.get(account) ?? 0) + 1);
    }
    this.pending.push(...fresh.slice(-VISIBLE));
    this.pending = this.pending.slice(-VISIBLE);
    this.pruneMeta();
  }

  /** Esquece quem saiu do escritório e não tem mais evento guardado. */
  private pruneMeta(): void {
    const needed = new Set([...this.items, ...this.pending, ...this.important, ...this.pendingImportant].map((f) => f.agentId));
    for (const a of this.ctx.store.snapshot?.agents ?? []) needed.add(a.id);
    for (const id of this.meta.keys()) if (!needed.has(id)) this.meta.delete(id);
  }

  private flush(): void {
    const importantIds = new Set(this.important.map((f) => f.id));
    for (const f of this.pendingImportant) if (!importantIds.has(f.id)) { this.important.push(f); importantIds.add(f.id); }
    this.important = this.important.slice(-VISIBLE);
    this.pendingImportant = [];
    const known = new Set(this.items.map((f) => f.id));
    for (const f of this.pending) if (!known.has(f.id)) this.items.push(f);
    this.pending = [];
    this.pendingCounts.clear();
    this.items = this.items.slice(-VISIBLE);
    this.pruneMeta();
    this.rows.sync(groupFeedItems((this.feedMode() === 'important' ? this.important : this.items).filter((f) => this.visible(f)).slice(-VISIBLE)));
    const scroller = this.list.parentElement!;
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  }

  private flushSoon(): void {
    this.scrolledUp = false;
    this.ctx.invalidate();
  }

  private resume(): void {
    this.hovering = false;
    this.scrolledUp = false;
    this.flush();
    this.ctx.invalidate();
  }

  private createRow(row: FeedDisplayRow): HTMLElement {
    const f = row.item;
    const m = this.meta.get(f.agentId) ?? this.metaFromStore(f.agentId);
    const avatar = m ? createAvatar(m, 'xs') : createAvatarPlaceholder('xs');
    const btn = h(
      'button',
      { class: 'ui-feed__row', type: 'button' },
      h('time', { class: 'ui-feed__time' }),
      avatar,
      h('span', { class: 'ui-feed__who' }),
      createAccountChip('sm'),
      h('span', { class: 'ui-feed__room' }),
      h('span', { class: 'ui-feed__icon', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-feed__text' }),
      h('span', { class: 'ui-feed__repeat' }),
    );
    btn.addEventListener('click', () => {
      if (this.ctx.agent(f.agentId)) this.ctx.select({ type: 'agent', id: f.agentId }, { focus: true });
      else if (this.ctx.store.room(f.roomId)) this.ctx.select({ type: 'room', id: f.roomId }, { focus: true });
    });
    const details = h('details', { class: 'ui-feed__details' }, h('summary', { text: '⋯', attrs: { 'aria-label': tr('Detalhes completos do evento'), title: tr('Detalhes completos do evento') } }), h('pre', { class: 'ui-feed__raw' }));
    return h('li', { class: 'ui-feed__item' }, btn, details);
  }

  private updateRow(li: HTMLElement, row: FeedDisplayRow): void {
    const f = row.item;
    const btn = li.firstElementChild as HTMLElement;
    const [time, avatar, who, chip, room, icon, text, repeat] = btn.children as unknown as HTMLElement[];
    const m = this.meta.get(f.agentId);
    setText(time, formatClock(f.activity.at));
    setAttr(time, 'datetime', new Date(f.activity.at).toISOString());
    if (m) updateAvatar(avatar, m, 'xs');
    setText(who, f.agentName);
    const acc = this.accountOf(f);
    updateAccountChip(chip, acc ? this.ctx.account(acc) : undefined, acc ?? '');
    setHidden(chip, !acc);
    setText(room, f.roomName);
    setText(icon, f.activity.icon);
    setText(text, activityDisplayText(f.activity));
    setText(repeat, row.repeatCount > 1 ? tr('{0} vezes', [row.repeatCount]) : '');
    setHidden(repeat, row.repeatCount <= 1);
    li.classList.toggle('is-error', row.items.some((item) => !!item.activity.error));
    li.classList.toggle('is-social', f.id.startsWith('social:'));
    // Fim de um shell (✅ terminou / ❌ falhou ou foi interrompido): linha com destaque próprio.
    const done = shellDoneKind(f.activity);
    li.classList.toggle('is-shell-ok', done === 'ok');
    li.classList.toggle('is-shell-fail', done === 'fail');
    const present = !!this.ctx.agent(f.agentId);
    li.classList.toggle('is-gone', !present);
    setTitle(btn, this.rowTitle(row));
    const details = li.children[1] as HTMLElement;
    setHidden(details, !row.items.some((item) => !!item.activity.detail || !!item.activity.tool || activityDisplayText(item.activity) !== item.activity.text));
    setText(details.children[1], row.items.map((item) => `${formatClock(item.activity.at)} · ${item.activity.text}${item.activity.tool ? `\n${tr('Ferramenta')}: ${item.activity.tool}` : ''}${item.activity.detail ? `\n${item.activity.detail}` : ''}`).join('\n\n'));
  }

  private rowTitle(row: FeedDisplayRow): string {
    const latest = row.item;
    const entries = row.items.map((item) => {
      const text = activityDisplayText(item.activity);
      const detail = sanitizeActivityText(item.activity.detail ?? '');
      return `${formatClock(item.activity.at)} · ${text}${detail ? `\n${detail}` : ''}`;
    });
    const repeats = row.repeatCount > 1 ? `\n${tr('{0} vezes', [row.repeatCount])}` : '';
    return `${formatClock(latest.activity.at)} · ${latest.agentName} em ${latest.roomName}${repeats}\n${entries.join('\n\n')}`;
  }

  private metaFromStore(id: string): AgentMeta | undefined {
    const a = this.ctx.agent(id);
    if (!a) return undefined;
    const m = { seed: a.seed, look: a.look, kind: a.kind, account: a.account, parts: a.parts };
    this.meta.set(id, m);
    return m;
  }
}
