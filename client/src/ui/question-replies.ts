// Pending questions remain readable even without a direct answer channel.
// Claude questions with a live permission hook use PermissionCard instead.
import type { Activity, AgentInfo } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { h, setHidden } from './dom';

export class QuestionReplies {
  readonly el = h('div', { class: 'ui-ask ui-question-replies', hidden: true });
  private shown = '';

  render(agent: AgentInfo | undefined, activities: readonly Activity[]): void {
    const items = activities.flatMap(activity => activity.questions ?? []);
    setHidden(this.el, !items.length);
    const key = JSON.stringify([agent?.id, agent?.sessionId, activities]);
    if (key === this.shown) return;
    this.shown = key;
    this.el.replaceChildren(
      ...items.map(question => h('div', { class: 'ui-ask__q' },
        question.header ? h('span', { class: 'ui-ask__tag', text: question.header }) : null,
        h('p', { class: 'ui-ask__question', text: question.question }),
        question.multiSelect ? h('p', { class: 'ui-ask__hint', text: tr('Pode escolher mais de uma') }) : null,
        h('ol', { class: 'ui-ask__opts' }, ...question.options.map(option => h('li', {},
          h('strong', { text: option.label }),
          option.description ? h('span', { class: 'ui-ask__desc', text: option.description }) : null))),
      )),
      ...(items.length ? [h('p', { class: 'ui-ask__hint', text: agent?.provider === 'codex'
        ? tr('Responda no cartão original do Codex. Mensagens em fila não respondem a esse cartão.')
        : tr('Responda no Claude ou use o cartão de resposta quando o plugin de permissões estiver conectado.') })] : []),
    );
  }
}
