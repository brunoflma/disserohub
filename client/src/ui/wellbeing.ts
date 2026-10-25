import type { WellbeingPreferences, WellbeingReport } from '../../../shared/wellbeing';
import { WellbeingClient, type WellbeingAction } from '../net/wellbeing';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setText } from './dom';
import { lineIcon } from './icons';
import { activityRecent, chartWidth, PERIOD_LABELS, wellbeingDuration, type WellbeingPeriod } from './wellbeing-model';
import './wellbeing.css';

// Same stroke and plotting motif as Meu dia, with a small clock to identify personal time.
const RHYTHM_ICON = lineIcon('<path d="M3 19V9m6 10V4m6 5V6M1 20h10"/><circle cx="17" cy="16" r="5"/><path d="M17 13v3l2 1"/>');
/** Nonmodal companion to Meu dia. No content, keys or window titles are recorded. */
export class WellbeingPanel implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  readonly reminderEl: HTMLElement;
  private readonly client = new WellbeingClient();
  private report?: WellbeingReport;
  private opened = false;
  private period: WellbeingPeriod = 'day';
  private loading = false;
  private saving = false;
  private failure = '';
  private lastInteraction = Date.now();
  private nextPulse = 0;
  private nextRefresh = 0;
  private pulsePending = false;
  private lastView = '';
  private notifiedId?: string;
  private claiming = false;
  private settingsExpanded = false;
  private readonly content: HTMLElement;
  private readonly heading: HTMLHeadingElement;
  private readonly tabs = new Map<WellbeingPeriod, HTMLButtonElement>();
  private readonly noticeTitle: HTMLElement;
  private readonly noticeText: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    this.button = iconButton(RHYTHM_ICON, 'Ritmo de uso: seu tempo, atividade dos agentes e pausas', () => this.toggle());
    setAttr(this.button, 'aria-expanded', 'false');
    setAttr(this.button, 'aria-controls', 'ui-wellbeing');
    this.heading = h('h2', { text: 'Ritmo de uso', tabIndex: -1 });
    const close = iconButton(lineIcon('<path d="m6 6 12 12M18 6 6 18"/>'), 'Fechar acompanhamento', () => this.close());
    const tabs = h('div', { class: 'ui-rhythm__periods', role: 'group', attrs: { 'aria-label': 'Período do acompanhamento' } });
    for (const period of ['day', 'week', 'month'] as const) {
      const tab = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: PERIOD_LABELS[period], attrs: { 'aria-pressed': period === this.period }, on: { click: () => { this.period = period; this.lastView = ''; this.render(); } } });
      this.tabs.set(period, tab); tabs.append(tab);
    }
    this.content = h('div', { class: 'ui-rhythm__content' });
    this.el = h('section', { class: 'ui-rhythm', hidden: true, attrs: { id: 'ui-wellbeing', 'aria-label': 'Ritmo de uso' }, on: { keydown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } } } },
      h('header', { class: 'ui-rhythm__head' }, h('div', {}, this.heading, h('p', { class: 'ui-rhythm__intro', text: 'Seu tempo e o trabalho dos agentes, separados.' })), close), tabs, this.content);
    this.noticeTitle = h('strong');
    this.noticeText = h('p');
    this.reminderEl = h('section', { class: 'ui-rhythm-notice', hidden: true, role: 'status', attrs: { 'aria-label': 'Lembrete de pausa', 'aria-live': 'polite' } },
      this.noticeTitle, this.noticeText,
      h('div', { class: 'ui-rhythm__actions' },
        h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Fazer uma pausa', on: { click: () => void this.act('pause') } }),
        h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Lembrar em 10 min', on: { click: () => void this.act('snooze') } }),
        h('button', { class: 'ui-link-btn', type: 'button', text: 'Ver meu ritmo', on: { click: () => this.open() } })));
    const interact = () => { this.lastInteraction = Date.now(); };
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'] as const) document.addEventListener(event, interact, { passive: true });
    window.addEventListener('focus', interact);
    window.addEventListener('blur', () => void this.pulse());
    document.addEventListener('visibilitychange', () => { void this.pulse(); if (!document.hidden) void this.refresh(); });
    window.addEventListener('pagehide', () => {
      if (!this.ctx.store.mock) void fetch('/api/wellbeing/pulse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false, clientId: this.client.clientId }), keepalive: true }).catch(() => {});
    });
    document.addEventListener('pointerdown', (event) => {
      if (this.opened && event.target instanceof Node && !this.el.contains(event.target) && !this.button.contains(event.target)) this.close(false);
    });
    let timer = window.setInterval(() => this.tick(), 5_000);
    window.addEventListener('pagehide', () => window.clearInterval(timer));
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      window.clearInterval(timer);
      timer = window.setInterval(() => this.tick(), 5_000);
      this.lastInteraction = Date.now();
      this.nextPulse = this.nextRefresh = 0;
      this.tick();
    });
    this.tick();
  }

  private tick(): void {
    if (this.ctx.store.mock) return;
    const now = Date.now();
    if (now >= this.nextPulse) { this.nextPulse = now + 15_000; void this.pulse(); }
    if (now >= this.nextRefresh) { this.nextRefresh = now + (document.hidden ? 15_000 : 5_000); void this.refresh(); }
  }
  private async pulse(): Promise<void> {
    if (this.pulsePending || this.ctx.store.mock) return;
    this.pulsePending = true;
    try {
      await this.client.pulse(activityRecent(this.lastInteraction, Date.now(), document.hasFocus(), !document.hidden, this.report?.preferences.trackingEnabled !== false && !this.ctx.isTimelapseOpen()));
    } catch { /* the lease expires server-side; do not count disconnected time */ }
    finally { this.pulsePending = false; }
  }
  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try { this.report = await this.client.snapshot(); this.failure = ''; this.notify(); }
    catch (error) { this.failure = error instanceof Error ? error.message : 'Acompanhamento indisponível. Tente novamente.'; }
    finally { this.loading = false; this.ctx.invalidate(); }
  }
  private toggle(): void { this.opened ? this.close() : this.open(); }
  private open(): void {
    this.opened = true; setHidden(this.el, false); setAttr(this.button, 'aria-expanded', 'true');
    this.lastView = ''; this.render(); this.heading.focus();
    if (!this.ctx.store.mock) void this.refresh();
  }
  private close(restoreFocus = true): void {
    this.opened = false; setHidden(this.el, true); setAttr(this.button, 'aria-expanded', 'false');
    if (restoreFocus) this.button.focus();
  }
  private async act(action: WellbeingAction): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try { this.report = await this.client.action(action); this.failure = ''; }
    catch (error) { this.failure = error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.'; this.open(); }
    finally { this.saving = false; this.lastView = ''; this.ctx.invalidate(); }
  }
  private async configure(patch: Partial<WellbeingPreferences>): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try { this.report = await this.client.configure(patch); this.failure = ''; }
    catch (error) { this.failure = error instanceof Error ? error.message : 'Não foi possível salvar a preferência.'; }
    finally { this.saving = false; this.lastView = ''; this.ctx.invalidate(); }
  }
  private notify(): void {
    const reminder = this.report?.reminder;
    if (!reminder || reminder.id === this.notifiedId || this.claiming) return;
    this.claiming = true;
    void this.client.action('ack', reminder.id).then((report) => {
      this.notifiedId = reminder.id;
      if (!report.notificationClaimed) return;
      this.ctx.announce(reminder.kind === 'break' ? 'Que tal uma pausa? Você atingiu o intervalo de uso ativo que configurou.' : 'Seu limite de uso de hoje foi atingido. Considere uma pausa mais longa.');
      if (document.hidden && this.ctx.prefs.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(reminder.kind === 'break' ? 'Que tal uma pausa?' : 'Seu ritmo de hoje', { body: 'O intervalo de uso que você configurou foi atingido. Abra o Dissero para acompanhar.', tag: 'dissero-wellbeing' });
        notification.onclick = () => { notification.close(); window.focus(); this.open(); };
      }
    }).catch(() => {}).finally(() => { this.claiming = false; });
  }

  render(): void {
    const reminder = this.failure ? undefined : this.report?.reminder;
    setHidden(this.reminderEl, !reminder || this.ctx.store.mock);
    this.button.classList.toggle('is-rhythm-due', !!reminder);
    if (reminder) {
      setText(this.noticeTitle, reminder.kind === 'break' ? 'Que tal uma pausa?' : 'Seu limite de hoje foi atingido');
      setText(this.noticeText, reminder.kind === 'break' ? 'Você chegou ao intervalo de uso ativo que configurou. Descanse um pouco antes de continuar.' : 'Considere encerrar por agora ou planejar uma pausa mais longa.');
    }
    if (!this.opened) return;
    // Keep a native select open while new samples arrive; update after focus leaves it.
    if (document.activeElement instanceof HTMLSelectElement && this.content.contains(document.activeElement)) return;
    for (const [period, button] of this.tabs) setAttr(button, 'aria-pressed', String(this.period === period));
    const viewKey = `${this.report?.now}|${this.period}|${this.failure}|${this.saving}|${this.ctx.store.mock}`;
    if (viewKey === this.lastView) return;
    this.lastView = viewKey;
    const focusControl = this.content.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.rhythmControl : undefined;
    this.content.replaceChildren();
    if (this.ctx.store.mock) { this.content.append(h('p', { text: 'O acompanhamento pessoal fica desativado na demonstração. Dados simulados não entram no seu histórico.' })); return; }
    if (this.failure) this.content.append(h('div', { class: 'ui-rhythm__error', role: 'status' }, h('p', { text: this.failure }), h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Tentar novamente', on: { click: () => void this.refresh() } })));
    if (!this.report) { if (!this.failure) this.content.append(h('p', { text: 'Carregando o acompanhamento…', role: 'status' })); return; }
    const r = this.report;
    if (r.persistence === 'error') this.content.append(h('p', { class: 'ui-rhythm__error', role: 'status', text: 'Os dados recentes ainda não foram salvos neste computador. O Dissero tentará novamente.' }));
    const p = r.periods[this.period];
    this.content.append(h('p', { class: 'ui-rhythm__range', text: this.range(p.start, p.end) }));
    const totals = h('dl', { class: 'ui-rhythm__totals' });
    totals.append(h('div', {}, h('dt', { text: 'Seu tempo ativo' }), h('dd', { class: 'ui-rhythm__personal', text: p.personalCoverageMs > 0 ? wellbeingDuration(p.personalMs) : 'Sem dados' })), h('div', {}, h('dt', { text: 'Agentes em atividade' }), h('dd', { class: 'ui-rhythm__agent', text: p.coverageMs > 0 ? wellbeingDuration(p.agentMs) : 'Sem dados' })));
    this.content.append(totals, h('p', { class: 'ui-rhythm__hint', text: 'Agentes simultâneos contam uma única vez. Esse tempo pode continuar enquanto você está longe.' }));
    const currentPaused = r.current.breakUntil > r.now;
    const state = currentPaused ? `Acompanhamento em pausa por mais ${wellbeingDuration(r.current.breakUntil - r.now)}.` : !r.preferences.trackingEnabled ? 'Seu acompanhamento está desativado.' : r.current.personalActive ? 'Seu uso ativo está sendo observado agora.' : 'Sem interação pessoal recente nas fontes acompanhadas.';
    this.content.append(h('p', { class: 'ui-rhythm__state', text: state, role: 'status' }));
    const metrics = h('dl', { class: 'ui-rhythm__metrics' });
    for (const [label, value] of [['Bloco atual sem pausa', wellbeingDuration(r.current.continuousMs)], ['Maior bloco no período', wellbeingDuration(p.longestBlockMs)], ['Pausas registradas', String(p.breakCount)]]) metrics.append(h('div', {}, h('dt', { text: label }), h('dd', { text: value })));
    this.content.append(metrics);
    const daily = r.periods.day.personalMs;
    const limit = r.preferences.dailyLimitMinutes * 60_000;
    this.content.append(h('div', { class: 'ui-rhythm__goal' }, h('p', {}, h('strong', { text: 'Seu limite de hoje' }), h('span', { text: r.periods.day.personalCoverageMs > 0 ? `${wellbeingDuration(daily)} de ${wellbeingDuration(limit)}` : 'Aguardando observação' })), h('progress', { hidden: r.periods.day.personalCoverageMs <= 0, attrs: { max: limit, value: Math.min(daily, limit), 'aria-label': 'Tempo ativo em relação ao limite de hoje' } })));
    this.content.append(h('div', { class: 'ui-rhythm__actions' }, h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: currentPaused ? 'Retomar acompanhamento' : `Pausa de ${r.preferences.breakMinutes} min`, attrs: { 'data-rhythm-control': 'pause' }, on: { click: () => void this.act(currentPaused ? 'resume' : 'pause') } })));
    this.content.append(this.chart());
    this.content.append(this.settings());
    const since = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(r.coverageStartAt);
    this.content.append(h('p', { class: 'ui-rhythm__coverage', text: `Coleta iniciada em ${since}. Períodos sem observação ficam sem dados; o histórico não é preenchido retroativamente.` }),
      h('p', { class: 'ui-rhythm__coverage', text: r.desktopSupported ? 'Seu tempo considera Dissero e Codex, ChatGPT ou Claude Desktop em foco, com interação nos últimos 2 minutos. Outros sites e terminais não são incluídos automaticamente. Nenhum texto digitado ou título de janela é registrado.' : 'Neste sistema, seu tempo considera apenas o Dissero em foco, com interação nos últimos 2 minutos. O tempo nos outros aplicativos não é medido.' }));
    if (focusControl) this.content.querySelector<HTMLElement>(`[data-rhythm-control="${focusControl}"]`)?.focus({ preventScroll: true });
  }

  private range(start: number, end: number): string {
    const format = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
    return this.period === 'day' ? format.format(start) : `${format.format(start)} a ${format.format(end - 1)}`;
  }
  private chart(): HTMLElement {
    const days = this.report!.periods[this.period].days;
    const section = h('section', { class: 'ui-rhythm__history', attrs: { 'aria-label': 'Histórico diário de uso' } }, h('h3', { text: 'Ao longo dos dias' }), h('p', { class: 'ui-rhythm__legend', text: 'Seu tempo ativo / agentes em atividade' }));
    if (!days.some((day) => day.coverageMs > 0)) { section.append(h('p', { text: 'Ainda sem dados neste período. O tempo aparecerá à medida que o Dissero acompanhar a atividade.' })); return section; }
    const max = Math.max(...days.map((day) => Math.max(day.personalMs, day.agentMs)), 60_000);
    const list = h('ul');
    for (const day of days) {
      const label = day.day.slice(8) + '/' + day.day.slice(5, 7);
      const item = h('li', {}, h('time', { text: label, attrs: { datetime: day.day } }));
      if (!day.coverageMs) item.append(h('span', { class: 'ui-rhythm__missing', text: 'Sem dados' }));
      else {
        const bars = h('div', { class: 'ui-rhythm__bars', attrs: { 'aria-hidden': 'true' } });
        bars.append(h('span', { class: 'ui-rhythm__bar-personal', style: `width:${chartWidth(day.personalMs, max)}` }), h('span', { class: 'ui-rhythm__bar-agent', style: `width:${chartWidth(day.agentMs, max)}` }));
        item.append(bars, h('span', { class: 'ui-rhythm__values', text: `${day.personalCoverageMs > 0 ? wellbeingDuration(day.personalMs) : 'sem dados'} / ${wellbeingDuration(day.agentMs)}` }));
      }
      list.append(item);
    }
    section.append(list); return section;
  }
  private settings(): HTMLElement {
    const p = this.report!.preferences;
    const details = h('details', { class: 'ui-rhythm__settings', on: { toggle: () => { if (details.isConnected) this.settingsExpanded = details.open; } } }, h('summary', { text: 'Lembretes e limites', attrs: { 'data-rhythm-control': 'settings' } }));
    details.open = this.settingsExpanded;
    const check = (key: 'trackingEnabled' | 'remindersEnabled', text: string) => {
      const input = h('input', { type: 'checkbox', attrs: { 'aria-label': text, 'data-rhythm-control': key }, on: { change: () => void this.configure({ [key]: input.checked }) } });
      input.checked = p[key]; input.disabled = this.saving;
      return h('label', { class: 'ui-rhythm__check' }, input, h('span', { text }));
    };
    details.append(check('trackingEnabled', 'Acompanhar meu tempo ativo'), check('remindersEnabled', 'Lembrar de fazer pausas'));
    const select = (key: 'breakAfterMinutes' | 'breakMinutes' | 'dailyLimitMinutes', label: string, choices: number[]) => {
      const control = h('select', { attrs: { 'aria-label': label, 'data-rhythm-control': key }, on: { change: () => void this.configure({ [key]: Number(control.value) }) } });
      for (const value of [...new Set([...choices, p[key]])].sort((a, b) => a - b)) { const option = h('option', { text: wellbeingDuration(value * 60_000), attrs: { value } }); option.selected = p[key] === value; control.append(option); }
      control.disabled = this.saving;
      return h('label', { class: 'ui-rhythm__field' }, h('span', { text: label }), control);
    };
    details.append(select('breakAfterMinutes', 'Lembrar após uso contínuo de', [25, 50, 90]), select('breakMinutes', 'Duração da pausa', [5, 10, 15]), select('dailyLimitMinutes', 'Limite pessoal por dia', [120, 240, 360, 480]), h('p', { class: 'ui-rhythm__hint', text: 'Os alertas usam somente o seu tempo ativo. As preferências são salvas neste computador.' }));
    return details;
  }
}
