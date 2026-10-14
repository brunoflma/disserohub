import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, FeedItem, RoomInfo } from '../../../shared/types';
import type { Selection } from '../world/api';
import type { SocialEvent } from '../world/api';
import type { UiContext } from './context';
import { FeedPanel } from './feed';

/** Elementos mínimos para exercitar o painel no ambiente Node, sem canvas nem animações. */
class Element {
  children: Element[] = [];
  parentElement: Element | null = null;
  className = '';
  textContent = '';
  hidden = false;
  title = '';
  innerHTML = '';
  value = '';
  dataset: Record<string, string> = {};
  scrollHeight = 1_000;
  scrollTop = 0;
  clientHeight = 100;
  isConnected = false;
  private attrs = new Map<string, string>();
  private handlers = new Map<string, (() => void)[]>();
  classList = {
    contains: (name: string) => this.className.split(' ').includes(name),
    add: (name: string) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
    remove: (name: string) => { this.className = this.className.split(' ').filter((c) => c !== name).join(' '); },
    toggle: (name: string, on: boolean) => { if (on) this.classList.add(name); else this.classList.remove(name); },
  };
  style = { getPropertyValue: () => '', setProperty: () => {} };

  constructor(readonly tag: string) {}
  get firstChild(): Element | null { return this.children[0] ?? null; }
  get firstElementChild(): Element | null { return this.firstChild; }
  get nextSibling(): Element | null { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  addEventListener(name: string, cb: () => void): void { this.handlers.set(name, [...(this.handlers.get(name) ?? []), cb]); }
  fire(name: string): void { this.handlers.get(name)?.forEach((cb) => cb()); }
  append(...children: Element[]): void { for (const child of children) this.insertBefore(child, null); }
  insertBefore(child: Element, cursor: Element | null): void {
    child.remove();
    this.children.splice(cursor ? this.children.indexOf(cursor) : this.children.length, 0, child);
    child.parentElement = this;
  }
  remove(): void {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  querySelector(tag: string): Element | null { return this.children.find((c) => c.tag === tag) ?? null; }
  getContext(): null { return null; }
  toDataURL(): string { return 'data:image/png;base64,'; }
}

function agent(id: string, account = '.claude'): AgentInfo {
  return {
    id, account, kind: 'main', roomId: 'r', name: id, look: 'f', role: 'Agente principal', sessionId: id,
    status: 'working', recent: [], tasks: [], startedAt: 0, lastEventAt: 0, statusSince: 0, seed: 1,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
  };
}

function item(id: string, a: AgentInfo): FeedItem {
  return { id, agentId: a.id, agentName: a.name, account: a.account, roomId: a.roomId, roomName: 'Sala', activity: { id, kind: 'other', icon: '💬', text: id, at: 0 } };
}

function activityItem(id: string, a: AgentInfo, patch: Partial<FeedItem['activity']>): FeedItem {
  const f = item(id, a);
  f.activity = { ...f.activity, ...patch };
  return f;
}

let elements: Element[];
function panel(feed: FeedItem[] = [], agents: AgentInfo[] = [], options: { feedMode?: 'important' | 'all'; rooms?: RoomInfo[]; selection?: Selection } = {}) {
  let receive!: (fresh: FeedItem[]) => void;
  let social!: (e: SocialEvent) => void;
  const snapshot = { agents, rooms: options.rooms ?? [] };
  const prefs = { hiddenAccounts: [] as string[], feedMode: options.feedMode ?? 'all' };
  let selected = options.selection ?? null;
  let open = true;
  const ctx = {
    store: { feed, snapshot, on: (_event: string, cb: typeof receive) => { receive = cb; } },
    world: { onSocialEvent: (cb: typeof social) => { social = cb; } },
    prefs, agent: (id: string) => snapshot.agents.find((a) => a.id === id), account: () => undefined, selection: () => selected,
    invalidate: () => {}, updatePrefs: (patch: Partial<typeof prefs>) => Object.assign(prefs, patch), togglePanel: () => {}, isPanelOpen: () => open,
  } as unknown as UiContext;
  const view = new FeedPanel(ctx);
  view.render();
  const el = (name: string) => elements.find((e) => e.className === name)!;
  const modeButtons = elements.filter((e) => e.className === 'ui-feed__mode-btn');
  return { view, receive: (fresh: FeedItem[]) => receive(fresh), social: (e: SocialEvent) => social(e), snapshot, prefs, setSelection: (next: Selection) => { selected = next; }, close: () => { open = false; },
    scroller: el('ui-feed__scroll'), list: el('ui-feed__list'), pill: el('ui-feed__new'), scope: el('ui-feed__scope'), important: modeButtons[0], all: modeButtons[1] };
}

beforeEach(() => {
  elements = [];
  vi.stubGlobal('document', { createElement: (tag: string) => { const el = new Element(tag); elements.push(el); return el; } });
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
});
afterEach(() => vi.unstubAllGlobals());

describe('FeedPanel focado', () => {
  it('keeps a pending question and complete raw details through a burst of routine events', () => {
    const a = agent('a');
    const question = activityItem('ask-old', a, { kind: 'ask', text: 'Precisa de você', detail: 'Comando original para consulta', at: 1 });
    const p = panel([], [a], { feedMode: 'important' });
    p.receive([question, ...Array.from({ length: 120 }, (_, i) => activityItem(`read-${i}`, a, { kind: 'read', text: 'Lendo arquivo', at: i + 2 }))]);
    p.view.render();
    expect(p.list.children).toHaveLength(1);
    expect(p.list.children[0].dataset.key).toBe('ask-old');
    expect(p.list.children[0].children[1].children[1].textContent).toContain('Comando original para consulta');
  });
  it('filtra Importantes, agrupa repetições e conserva os eventos crus', () => {
    const a = agent('a');
    const first = activityItem('ask-1', a, { kind: 'ask', icon: '❓', text: 'Precisa de você', at: 100 });
    const second = activityItem('ask-2', a, { kind: 'ask', icon: '❓', text: 'Precisa de você', at: 105 });
    const routine = activityItem('read-1', a, { kind: 'read', icon: '📖', text: 'Lendo um arquivo', at: 106 });
    const p = panel([first, second, routine], [a], { feedMode: 'important' });
    expect(p.important.getAttribute('aria-pressed')).toBe('true');
    expect(p.all.getAttribute('aria-pressed')).toBe('false');
    expect(p.list.children).toHaveLength(1);
    expect(p.list.children[0].firstElementChild!.children[7].textContent).toContain('2 vezes');
    expect((p.view as unknown as { items: FeedItem[] }).items).toEqual([first, second, routine]);

    p.all.fire('click');
    p.view.render();
    expect(p.all.getAttribute('aria-pressed')).toBe('true');
    expect(p.list.children).toHaveLength(2);
  });

  it('oferece projeto/agente ativos e volta a Todos quando o escopo desaparece', () => {
    const a = agent('a');
    const b = agent('b');
    a.roomId = '/p/a';
    b.roomId = '/p/b';
    const rooms: RoomInfo[] = [
      { id: '/p/a', name: 'Projeto A', path: '/p/a', slot: 0, seed: 1, createdAt: 0 },
      { id: '/p/b', name: 'Projeto B', path: '/p/b', slot: 1, seed: 2, createdAt: 0 },
    ];
    const p = panel([item('a-event', a), item('b-event', b)], [a, b], { feedMode: 'all', rooms, selection: { type: 'agent', id: a.id } });
    expect(p.scope.children.map((option) => option.getAttribute('value'))).toEqual(['all', 'project:/p/a', 'agent:a']);
    p.scope.value = 'project:/p/a';
    p.scope.fire('change');
    p.view.render();
    expect(p.list.children.map((row) => row.dataset.key)).toEqual(['a-event']);

    p.setSelection(null);
    p.snapshot.rooms = [];
    p.view.render();
    expect(p.scope.value).toBe('all');
    expect(p.list.children.map((row) => row.dataset.key)).toEqual(['a-event', 'b-event']);
  });
});

describe('FeedPanel pausado', () => {
  it.each(['SSE', 'social'])('guarda só os 50 eventos mais novos de %s, sem perder a contagem por conta', (source) => {
    const shown = agent('visível');
    const hidden = agent('oculto', '.claude-2');
    const old = item('antes', shown);
    const p = panel([old], [shown, hidden]);
    p.scroller.scrollTop = 0;
    p.scroller.fire('scroll');
    const fresh = Array.from({ length: 120 }, (_, i) => item(`novo-${i}`, i < 70 ? shown : hidden));
    if (source === 'SSE') p.receive(fresh);
    else for (const f of fresh) p.social({ id: f.id, agentId: f.agentId, at: f.activity.at, icon: f.activity.icon, text: f.activity.text, place: f.roomName });
    // A retenção é observada só para comprovar o teto de memória, além da saída do painel.
    const retained = (p.view as unknown as { pending: FeedItem[] }).pending;
    expect(retained).toHaveLength(50);
    expect(retained.map((f) => f.id)).toEqual(fresh.slice(70).map((f) => f.id));
    p.view.render();
    expect(p.list.children.map((e) => e.dataset.key)).toEqual(['antes']);
    expect(p.pill.textContent).toBe('99 novas');
    p.prefs.hiddenAccounts = ['.claude-2'];
    p.view.render();
    expect(p.pill.hidden).toBe(false);
    expect(p.pill.textContent).toBe('70 novas');
    p.prefs.hiddenAccounts = [];
    p.pill.fire('click');
    p.view.render();
    expect(p.list.children.map((e) => e.dataset.key)).toEqual(fresh.slice(70).map((f) => f.id));
    expect(p.pill.hidden).toBe(true);
    p.scroller.scrollTop = 0;
    p.scroller.fire('scroll');
    p.receive([item('depois', shown)]);
    p.view.render();
    expect(p.pill.textContent).toBe('1 nova');
  });

  it.each(['retomar', 'recolher'])('preserva os metadados das linhas e pendências, liberando o resto ao %s', (action) => {
    const old = agent('antigo');
    const p = panel([item('antes', old)], [old]);
    const meta = (p.view as unknown as { meta: Map<string, Pick<AgentInfo, 'seed' | 'account'>> }).meta;
    p.scroller.scrollTop = 0;
    p.scroller.fire('scroll');
    for (let i = 0; i < 51; i++) {
      const a = agent(`sessão-${i}`);
      p.snapshot.agents = [a];
      p.receive([item(`novo-${i}`, a)]);
      p.view.render();
    }
    const retainedIds = ['antigo', ...Array.from({ length: 50 }, (_, i) => `sessão-${i + 1}`)];
    expect([...meta.keys()]).toEqual(retainedIds);
    // A saída do agente não apaga a aparência/conta de um evento que ainda está guardado; quem está no escritório
    // fica mesmo sem evento (o render recriaria a cada quadro).
    p.snapshot.agents = [agent('sem-evento')];
    p.view.render();
    expect([...meta.keys()]).toEqual([...retainedIds, 'sem-evento']);
    expect(meta.get('sessão-1')).toEqual(expect.objectContaining({ seed: 1, account: '.claude' }));
    if (action === 'retomar') p.pill.fire('click');
    else p.close();
    p.view.render();
    expect([...meta.keys()]).toEqual([...retainedIds.slice(1), 'sem-evento']);
    expect(p.list.children).toHaveLength(50);
    expect(p.list.children[0].firstElementChild!.children[1].dataset.sig).toContain('1|f|main|');
  });
});
