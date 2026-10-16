// Replies stay bound to the original question while selection/snapshots change.
import { ANSWER_OTHER_MAX } from '../../../shared/answers';
import { isAsyncQuestion } from '../../../shared/question-replies';
import type { Activity, AgentInfo, AskQuestion } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { access } from '../net/access';
import type { UiContext } from './context';
import { h, setHidden, setText } from './dom';
import { answerFor } from './permission';
import { isSettled, pollDelay, POLL_LIMIT_MS, sendStatusText, type SendState } from './composer-model';

interface ReplyRow {
  el: HTMLElement;
  agentId: string;
  activity: Activity;
  question: AskQuestion;
  options: HTMLInputElement[];
  other?: HTMLInputElement;
  text: HTMLTextAreaElement;
  button: HTMLButtonElement;
  status: HTMLElement;
  note: HTMLElement;
  enabled: boolean;
  state?: SendState;
}

export class QuestionReplies {
  readonly el = h('div', { class: 'ui-ask ui-question-replies', hidden: true });
  private rows = new Map<string, ReplyRow>();
  private shown = '';

  constructor(private ctx: UiContext) {}

  render(agent: AgentInfo | undefined, activities: readonly Activity[]): void {
    const items = activities.flatMap(activity => (activity.questions ?? []).map(question => ({ activity, question })));
    setHidden(this.el, !items.length);
    const keys: string[] = [];
    for (const { activity, question } of items) {
      const key = JSON.stringify([agent?.id, agent?.sessionId, activity.id, question]);
      keys.push(key);
      const supported = agent?.provider === 'codex' && agent.kind === 'main' && isAsyncQuestion(activity);
      let row = this.rows.get(key);
      if (!row) {
        row = this.create(agent?.id ?? '', activity, question, supported);
        this.rows.set(key, row);
      }
      row.enabled = !!supported && !this.ctx.store.replaying && !this.ctx.store.mock
        && !!this.ctx.store.snapshot?.meta.messages && access().messages && !!agent?.canMessage
        && agent.status !== 'done' && agent.status !== 'offline';
      const note = !supported ? tr('Esta pergunta precisa do cliente de origem; não será enviada como mensagem em fila.')
        : this.ctx.store.replaying ? tr('Sem respostas no timelapse.')
          : !row.enabled ? tr('O canal de mensagens deste agente não está disponível para responder daqui.')
            : tr('A resposta entra na fila desta sessão do Codex. O cartão só encerra quando a sessão registrar a resposta ou encerrar a pergunta.');
      setText(row.note, note);
      setHidden(row.button, !supported);
      row.text.disabled = !row.enabled || !!row.state && row.state.phase !== 'rejected' && row.state.phase !== 'failed';
      for (const input of [...row.options, ...(row.other ? [row.other] : [])]) input.disabled = row.text.disabled;
      this.sync(row);
    }
    const shown = keys.join('|');
    if (this.shown !== shown) {
      this.shown = shown;
      this.el.replaceChildren(...keys.map(key => this.rows.get(key)!.el));
    }
    // Keep drafts for recently visited questions without accumulating the whole session history.
    if (this.rows.size > 128) for (const key of this.rows.keys()) {
      if (!keys.includes(key) && isSettled(this.rows.get(key)?.state?.phase ?? 'rejected')) this.rows.delete(key);
      if (this.rows.size <= 128) break;
    }
  }

  private answer(row: ReplyRow) {
    return answerFor(row.question, { options: row.options.filter(i => i.checked).map(i => Number(i.value)),
      otherOn: !row.other || row.other.checked, otherText: row.text.value });
  }

  private sync(row: ReplyRow): void {
    const busy = !!row.state && (!!row.state.id || row.state.phase !== 'failed' && row.state.phase !== 'rejected');
    row.button.disabled = !row.enabled || busy || !this.answer(row);
    setText(row.button, busy ? row.state?.phase === 'failed' || row.state?.phase === 'rejected'
      ? tr('Confira a entrega na sessão') : tr('Resposta na fila') : tr('Enviar resposta'));
    const message = sendStatusText(row.state, Date.now(), 'codex');
    setText(row.status, message);
    setHidden(row.status, !message);
    row.status.classList.toggle('is-error', row.state?.phase === 'failed' || row.state?.phase === 'rejected');
  }

  private create(agentId: string, activity: Activity, question: AskQuestion, supported: boolean): ReplyRow {
    const name = `reply-${agentId}-${activity.id}-${question.index}`;
    const options = question.options.map(option => ({ option, input: h('input', {
      type: question.multiSelect ? 'checkbox' : 'radio', class: 'ui-perm-ask__input', attrs: { name, value: option.index },
    }) }));
    const other = options.length ? h('input', { type: question.multiSelect ? 'checkbox' : 'radio', class: 'ui-perm-ask__input', attrs: { name, value: 'other' } }) : undefined;
    const text = h('textarea', { class: 'ui-msg__input ui-question-reply__text', attrs: { rows: 3, maxlength: ANSWER_OTHER_MAX,
      placeholder: tr('Escreva a sua resposta'), 'aria-label': tr('Resposta para: {0}', [question.question]), autocomplete: 'off' } });
    const button = h('button', { type: 'button', class: 'ui-btn ui-btn--sm', text: tr('Enviar resposta') });
    const status = h('p', { class: 'ui-msg__status', hidden: true, attrs: { role: 'status', 'aria-live': 'polite' } });
    const note = h('p', { class: 'ui-ask__hint' });
    const el = h('fieldset', { class: 'ui-perm-ask__q ui-question-reply' },
      h('legend', { class: 'ui-perm-ask__legend' }, question.header ? h('span', { class: 'ui-ask__tag', text: question.header }) : null,
        h('span', { class: 'ui-ask__question', text: question.question })),
      ...options.map(({ option, input }) => h(supported ? 'label' : 'div', { class: 'ui-perm-ask__opt' }, supported ? input : null,
        h('span', { class: 'ui-perm-ask__opt-text' }, h('strong', { text: option.label }), option.description ? h('span', { class: 'ui-ask__desc', text: option.description }) : null))),
      supported && other ? h('label', { class: 'ui-perm-ask__opt' }, other, h('span', { text: tr('Outro') })) : null,
      supported ? text : null, note, supported ? h('div', { class: 'ui-question-reply__actions' }, button) : null, supported ? status : null);
    const row: ReplyRow = { el, agentId, activity, question, options: options.map(o => o.input), other, text, button, status, note, enabled: false };
    for (const input of [...row.options, ...(other ? [other] : [])]) input.addEventListener('change', () => this.sync(row));
    text.addEventListener('input', () => { if (other && text.value.trim()) other.checked = true; this.sync(row); });
    text.addEventListener('keydown', e => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void this.send(row); }
      if (e.key === 'Escape') { e.preventDefault(); text.blur(); }
    });
    button.addEventListener('click', () => void this.send(row));
    return row;
  }

  private async send(row: ReplyRow): Promise<void> {
    const answer = this.answer(row);
    if (!row.enabled || row.button.disabled || !answer) return;
    row.state = { phase: 'sending', at: Date.now() };
    this.ctx.invalidate();
    this.sync(row);
    try {
      const result = await this.ctx.store.answerQuestion({ agentId: row.agentId, activityId: row.activity.id, answer });
      if ('error' in result) row.state = { phase: 'rejected', error: result.error, at: Date.now() };
      else {
        row.state = { phase: result.message.status, id: result.message.id, error: result.message.error, at: result.message.updatedAt };
        void this.poll(row, result.message.id);
      }
    } catch { row.state = { phase: 'rejected', error: tr('não foi possível falar com o Dissero; confira a entrega antes de tentar novamente'), at: Date.now() }; }
    this.sync(row);
    this.ctx.invalidate();
  }

  private async poll(row: ReplyRow, id: string): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < POLL_LIMIT_MS && row.state?.id === id && !isSettled(row.state.phase)) {
      await new Promise(resolve => setTimeout(resolve, pollDelay(Date.now() - started)));
      try {
        const message = await this.ctx.store.messageStatus(id);
        if (!message) { row.state = { phase: 'rejected', id, at: Date.now(), error: tr('sem recibo desta resposta; confira a sessão antes de reenviar') }; break; }
        row.state = { phase: message.status, id, error: message.error, at: message.updatedAt };
      } catch { /* Read failures do not replay the POST. Continue checking this receipt. */ }
      this.sync(row);
      this.ctx.invalidate();
    }
    if (row.state?.id === id && !isSettled(row.state.phase)) {
      row.state = { phase: 'rejected', id, at: Date.now(), error: tr('entrega ainda não confirmada; confira a sessão antes de reenviar') };
      this.sync(row);
      this.ctx.invalidate();
    }
    this.sync(row);
    this.ctx.invalidate();
  }
}
