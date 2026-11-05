import { copyText, h, setText } from './dom';
import './work-templates.css';

export interface TaskTemplate {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly objectivePlaceholder: string;
  readonly contextPlaceholder: string;
  readonly guidance: string;
  readonly expectedDeliverable: readonly string[];
  readonly scopeConstraints: readonly string[];
}

export const TASK_TEMPLATES = [
  {
    id: 'research',
    title: 'Pesquisa',
    summary: 'Investigue uma pergunta e organize evidências e fontes.',
    objectivePlaceholder: 'Que pergunta precisa ser respondida? Qual decisão a pesquisa deve apoiar?',
    contextPlaceholder: 'Inclua contexto, período, local, público ou fontes que devem ser considerados.',
    guidance: 'Investigue a pergunta delimitada e use fontes confiáveis, priorizando fontes primárias quando disponíveis. Separe fatos verificados de inferências e indique quando não houver evidência suficiente.',
    expectedDeliverable: [
      'Resumo direto da resposta, seguido dos principais achados.',
      'Fontes identificadas por título, organização, data e link, com a afirmação que cada uma sustenta.',
      'Limitações, divergências entre fontes e perguntas ainda sem resposta.',
    ],
    scopeConstraints: [
      'Fique dentro da pergunta e dos recortes informados; não transforme a pesquisa em implementação.',
      'Não invente fontes, citações, datas ou fatos. Sinalize claramente qualquer lacuna.',
      'Não altere arquivos, serviços ou dados como parte da pesquisa.',
    ],
  },
  {
    id: 'code-review',
    title: 'Revisão de código',
    summary: 'Revise mudanças procurando defeitos concretos e regressões.',
    objectivePlaceholder: 'Qual mudança, comportamento ou risco deve ser revisado?',
    contextPlaceholder: 'Indique o diff, arquivos, requisitos ou comandos relevantes para a revisão.',
    guidance: 'Inspecione o código e o contexto necessário para avaliar o objetivo informado. Priorize defeitos reproduzíveis ou sustentados por evidência, considerando impacto e probabilidade.',
    expectedDeliverable: [
      'Achados ordenados por severidade, cada um com arquivo e linha, cenário de falha e evidência.',
      'Verificações executadas e seus resultados, ou a razão objetiva para não executá-las.',
      'Se não houver achados, declare isso e registre os limites da revisão.',
    ],
    scopeConstraints: [
      'Faça revisão somente leitura; não edite arquivos nem aplique correções.',
      'Não apresente preferência de estilo como defeito funcional ou de segurança.',
      'Não declare que algo está seguro ou correto além do código e dos cenários efetivamente examinados.',
    ],
  },
  {
    id: 'bug-fix',
    title: 'Correção de bug',
    summary: 'Encontre a causa do defeito e aplique uma correção delimitada.',
    objectivePlaceholder: 'Descreva o comportamento atual e o comportamento esperado.',
    contextPlaceholder: 'Inclua passos para reproduzir, mensagens de erro, ambiente e arquivos suspeitos.',
    guidance: 'Confirme o cenário do defeito, localize sua causa e faça a menor correção que restaure o comportamento esperado. Verifique o caminho corrigido com uma checagem apropriada.',
    expectedDeliverable: [
      'Causa identificada e explicação de como a correção resolve o cenário.',
      'Arquivos alterados e resumo objetivo da mudança.',
      'Comandos ou verificações executados, resultados e riscos que permanecerem.',
    ],
    scopeConstraints: [
      'Limite as alterações à correção e às verificações necessárias; evite refatorações não relacionadas.',
      'Preserve contratos e compatibilidade existentes, salvo quando a mudança solicitada exigir outra coisa.',
      'Não oculte falhas de validação nem declare o bug resolvido sem evidência.',
    ],
  },
  {
    id: 'implementation',
    title: 'Implementação',
    summary: 'Implemente um comportamento novo respeitando limites e convenções.',
    objectivePlaceholder: 'Qual comportamento ou resultado deve ser implementado?',
    contextPlaceholder: 'Liste arquivos permitidos, interfaces existentes, convenções e casos importantes.',
    guidance: 'Inspecione as interfaces e convenções relevantes antes de alterar o código. Implemente o comportamento solicitado com uma mudança proporcional e valide os caminhos afetados.',
    expectedDeliverable: [
      'Resumo do comportamento implementado e das decisões relevantes.',
      'Arquivos alterados e interfaces afetadas.',
      'Verificações executadas com resultados e limitações restantes.',
    ],
    scopeConstraints: [
      'Altere somente o escopo autorizado e os arquivos necessários para atendê-lo.',
      'Preserve comportamento existente fora do pedido e evite dependências novas sem necessidade comprovada.',
      'Não amplie interfaces públicas nem faça mudanças incompatíveis sem explicitar a necessidade.',
    ],
  },
  {
    id: 'validation',
    title: 'Validação',
    summary: 'Verifique uma mudança usando critérios e evidências observáveis.',
    objectivePlaceholder: 'O que precisa ser validado e quais critérios definem aprovação?',
    contextPlaceholder: 'Informe arquivos, versão, ambiente, comandos ou evidências disponíveis.',
    guidance: 'Compare a mudança com cada critério informado. Escolha verificações seguras e diretamente relacionadas, e diferencie resultado observado, inferência e item não verificado.',
    expectedDeliverable: [
      'Resultado por critério: aprovado, reprovado ou não verificado, com evidência.',
      'Comandos e checagens executados, resultados e ambiente observado.',
      'Falhas, limitações e próximos passos necessários para concluir a validação.',
    ],
    scopeConstraints: [
      'Trabalhe somente em leitura; não corrija arquivos nem altere dados ou serviços.',
      'Não execute ações destrutivas, publicações ou mudanças de estado.',
      'Não trate uma checagem não executada como aprovada.',
    ],
  },
  {
    id: 'release-preparation',
    title: 'Preparação de release',
    summary: 'Avalie prontidão e prepare os materiais de uma release.',
    objectivePlaceholder: 'Qual versão ou conjunto de mudanças deve ser preparado para release?',
    contextPlaceholder: 'Inclua alterações, critérios, ambiente-alvo, riscos e materiais de release existentes.',
    guidance: 'Avalie a prontidão segundo os critérios informados e prepare os materiais solicitados. Separe itens confirmados de pendências e associe cada conclusão à evidência disponível.',
    expectedDeliverable: [
      'Checklist de prontidão com estado, evidência e responsável ou próximo passo quando conhecido.',
      'Notas de release em linguagem clara, alinhadas às mudanças confirmadas.',
      'Bloqueios, riscos, verificações pendentes e decisões necessárias antes da publicação.',
    ],
    scopeConstraints: [
      'Não faça commit, push, merge, publicação, deploy, alteração de versão ou mudança em produção.',
      'Não marque como concluída uma etapa que não tenha evidência observável.',
      'Mantenha recomendações e materiais de preparação separados de qualquer ação operacional.',
    ],
  },
] as const satisfies readonly TaskTemplate[];

export type TaskTemplateId = (typeof TASK_TEMPLATES)[number]['id'];

export interface TaskPromptInput {
  readonly templateId: TaskTemplateId;
  readonly objective: string;
  readonly context: string;
  readonly projectName?: string;
}

export interface TaskTemplateDraft {
  readonly objective: string;
  readonly context: string;
}

function getTemplate(id: TaskTemplateId): (typeof TASK_TEMPLATES)[number] {
  const template = TASK_TEMPLATES.find((item) => item.id === id);
  if (!template) throw new Error(`Modelo de tarefa desconhecido: ${id}`);
  return template;
}

export function buildTaskPrompt(input: TaskPromptInput): string {
  const template = getTemplate(input.templateId);
  const objective = input.objective.trim() || '[descreva o objetivo da tarefa]';
  const context = input.context.trim() || 'Nenhum contexto adicional foi informado.';
  const sections = [`# ${template.title}`];
  const projectName = input.projectName?.trim();

  if (projectName) sections.push(`## Projeto\n${projectName}`);
  sections.push(
    `## Objetivo\n${objective}`,
    `## Contexto\n${context}`,
    `## Orientação\n${template.guidance}`,
    `## Entregável esperado\n${template.expectedDeliverable.map((item) => `- ${item}`).join('\n')}`,
    `## Restrições de escopo\n${[
      'Respeite os limites descritos neste pedido e não amplie o escopo por conta própria.',
      'Não invente evidências nem declare como concluída uma ação que não foi verificada.',
      ...template.scopeConstraints,
    ].map((item) => `- ${item}`).join('\n')}`,
    `## Como apresentar o resultado\n${[
      'Resuma o que foi realizado e a evidência que sustenta o resultado.',
      'Liste arquivos alterados e verificações executadas; indique explicitamente quando não se aplicarem ou não tiverem sido executados.',
      'Aponte limitações, riscos restantes e decisões que dependem de outra pessoa.',
    ].map((item) => `- ${item}`).join('\n')}`,
  );

  return sections.join('\n\n');
}

/** Estado em memória do editor, separado do DOM para preservar rascunhos por modelo. */
export class TaskTemplateEditorState {
  private selectedTemplateId: TaskTemplateId = TASK_TEMPLATES[0].id;
  private projectName = '';
  private readonly drafts = new Map<TaskTemplateId, { objective: string; context: string }>(
    TASK_TEMPLATES.map((template) => [template.id, { objective: '', context: '' }]),
  );

  get template(): (typeof TASK_TEMPLATES)[number] {
    return getTemplate(this.selectedTemplateId);
  }

  get draft(): TaskTemplateDraft {
    const draft = this.drafts.get(this.selectedTemplateId);
    return draft ? { ...draft } : { objective: '', context: '' };
  }

  get prompt(): string {
    return buildTaskPrompt({
      templateId: this.selectedTemplateId,
      ...this.draft,
      projectName: this.projectName,
    });
  }

  get canCopy(): boolean {
    return this.draft.objective.trim().length > 0;
  }

  selectTemplate(id: TaskTemplateId): void {
    getTemplate(id);
    this.selectedTemplateId = id;
  }

  setObjective(objective: string): void {
    this.updateDraft({ objective });
  }

  setContext(context: string): void {
    this.updateDraft({ context });
  }

  setProject(name: string): void {
    this.projectName = name.trim();
  }

  private updateDraft(update: Partial<{ objective: string; context: string }>): void {
    const current = this.drafts.get(this.selectedTemplateId) ?? { objective: '', context: '' };
    this.drafts.set(this.selectedTemplateId, { ...current, ...update });
  }
}

let nextInstanceId = 0;

export class WorkTemplates {
  readonly el: HTMLElement;

  private readonly state = new TaskTemplateEditorState();
  private readonly listeners = new AbortController();
  private readonly selector: HTMLSelectElement;
  private readonly description: HTMLParagraphElement;
  private readonly objective: HTMLTextAreaElement;
  private readonly context: HTMLTextAreaElement;
  private readonly preview: HTMLTextAreaElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly feedback: HTMLParagraphElement;
  private copying = false;
  private disposed = false;

  constructor() {
    const instanceId = `work-templates-${++nextInstanceId}`;
    const heading = h('h2', { class: 'work-templates__title', text: 'Modelos de tarefa', attrs: { id: `${instanceId}-title` } });
    this.selector = h('select', { class: 'work-templates__control', attrs: { 'aria-label': 'Modelo de tarefa' } });
    for (const template of TASK_TEMPLATES) {
      this.selector.append(h('option', { text: template.title, attrs: { value: template.id } }));
    }
    this.description = h('p', { class: 'work-templates__description' });
    this.objective = h('textarea', {
      class: 'work-templates__control work-templates__input',
      attrs: { rows: 3, 'aria-label': 'Objetivo da tarefa' },
    });
    this.context = h('textarea', {
      class: 'work-templates__control work-templates__input',
      attrs: { rows: 4, 'aria-label': 'Contexto adicional' },
    });
    this.preview = h('textarea', {
      class: 'work-templates__control work-templates__preview',
      attrs: { rows: 16, readonly: true, spellcheck: false, 'aria-label': 'Prévia do prompt gerado' },
    });
    this.copyButton = h('button', {
      class: 'ui-btn ui-btn--primary work-templates__copy',
      type: 'button',
      text: 'Copiar prompt',
      attrs: { 'aria-label': 'Copiar prompt gerado' },
      on: { click: () => void this.copyPrompt() },
    });
    this.feedback = h('p', { class: 'work-templates__feedback', role: 'status', attrs: { 'aria-live': 'polite' } });

    const selectorField = this.field('Modelo', this.selector);
    const objectiveField = this.field('Objetivo', this.objective);
    const contextField = this.field('Contexto adicional', this.context);
    const promptField = this.field('Prévia somente leitura', this.preview);
    const editorFields = h('div', { class: 'work-templates__fields' }, objectiveField, contextField);
    const previewHeader = h('div', { class: 'work-templates__preview-header' },
      h('div', { class: 'work-templates__preview-heading' },
        h('h3', { class: 'work-templates__subtitle', text: 'Prompt gerado' }),
        h('p', { class: 'work-templates__hint', text: 'Revise o texto e copie quando o objetivo estiver preenchido.' }),
      ),
      this.copyButton,
    );
    const previewGroup = h('div', { class: 'work-templates__preview-group' }, previewHeader, promptField, this.feedback);

    this.el = h('section', {
      class: 'work-templates',
      attrs: { 'aria-labelledby': `${instanceId}-title` },
    },
    h('header', { class: 'work-templates__header' }, heading,
      h('p', { class: 'work-templates__intro', text: 'Monte um pedido claro a partir de um modelo. O texto fica nesta tela até você copiá-lo.' }),
    ),
    selectorField,
    this.description,
    editorFields,
    previewGroup,
    );

    this.selector.addEventListener('change', () => this.changeTemplate(), { signal: this.listeners.signal });
    this.objective.addEventListener('input', () => {
      this.state.setObjective(this.objective.value);
      this.updatePreview();
      setText(this.feedback, '');
    }, { signal: this.listeners.signal });
    this.context.addEventListener('input', () => {
      this.state.setContext(this.context.value);
      this.updatePreview();
      setText(this.feedback, '');
    }, { signal: this.listeners.signal });

    this.populateSelectedTemplate();
  }

  setProject(name: string): void {
    this.state.setProject(name);
    this.updatePreview();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
  }

  private field(labelText: string, control: HTMLElement): HTMLLabelElement {
    return h('label', { class: 'work-templates__field' },
      h('span', { class: 'work-templates__label', text: labelText }),
      control,
    );
  }

  private changeTemplate(): void {
    this.state.setObjective(this.objective.value);
    this.state.setContext(this.context.value);
    const selectedId = this.selector.value as TaskTemplateId;
    if (!TASK_TEMPLATES.some((template) => template.id === selectedId)) {
      this.selector.value = this.state.template.id;
      return;
    }
    this.state.selectTemplate(selectedId);
    setText(this.feedback, '');
    this.populateSelectedTemplate();
  }

  private populateSelectedTemplate(): void {
    const template = this.state.template;
    const draft = this.state.draft;
    this.selector.value = template.id;
    this.description.textContent = template.summary;
    this.objective.placeholder = template.objectivePlaceholder;
    this.context.placeholder = template.contextPlaceholder;
    this.objective.value = draft.objective;
    this.context.value = draft.context;
    this.updatePreview();
  }

  private updatePreview(): void {
    const wasFocused = document.activeElement === this.preview;
    const start = wasFocused ? this.preview.selectionStart : null;
    const end = wasFocused ? this.preview.selectionEnd : null;
    const direction = wasFocused ? this.preview.selectionDirection : null;
    const prompt = this.state.prompt;
    if (this.preview.value !== prompt) {
      this.preview.value = prompt;
      if (wasFocused && start !== null && end !== null) {
        const max = this.preview.value.length;
        this.preview.setSelectionRange(Math.min(start, max), Math.min(end, max), direction ?? 'none');
      }
    }
    this.copyButton.disabled = this.copying || !this.state.canCopy;
  }

  private async copyPrompt(): Promise<void> {
    if (this.disposed || this.copying || !this.state.canCopy) return;
    const prompt = this.state.prompt;
    this.copying = true;
    this.updatePreview();
    try {
      const copied = await copyText(prompt);
      if (!this.disposed && this.state.prompt === prompt) setText(this.feedback, copied
        ? 'Prompt copiado para a área de transferência.'
        : 'Não foi possível copiar. Selecione o texto da prévia e copie manualmente.');
    } catch {
      if (!this.disposed && this.state.prompt === prompt) setText(this.feedback, 'Não foi possível copiar. Selecione o texto da prévia e copie manualmente.');
    } finally {
      this.copying = false;
      if (!this.disposed) this.updatePreview();
    }
  }
}
