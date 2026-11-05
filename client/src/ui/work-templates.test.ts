import { describe, expect, it } from 'vitest';
import {
  buildTaskPrompt,
  TASK_TEMPLATES,
  TaskTemplateEditorState,
} from './work-templates';

describe('modelos de tarefa', () => {
  it('disponibiliza os seis modelos solicitados com entregáveis e limites explícitos', () => {
    expect(TASK_TEMPLATES.map(({ id }) => id)).toEqual([
      'research',
      'code-review',
      'bug-fix',
      'implementation',
      'validation',
      'release-preparation',
    ]);

    for (const template of TASK_TEMPLATES) {
      expect(template.expectedDeliverable.length, `${template.id}: entregável`).toBeGreaterThan(0);
      expect(template.scopeConstraints.length, `${template.id}: restrições`).toBeGreaterThan(0);
    }
  });

  it('gera um pedido em pt-BR com objetivo, contexto, entregável, restrições e projeto', () => {
    const prompt = buildTaskPrompt({
      templateId: 'implementation',
      objective: 'Adicionar exportação CSV',
      context: 'A interface já oferece exportação JSON.',
      projectName: 'Painel Aurora',
    });

    expect(prompt).toContain('# Implementação');
    expect(prompt).toContain('## Projeto\nPainel Aurora');
    expect(prompt).toContain('## Objetivo\nAdicionar exportação CSV');
    expect(prompt).toContain('## Contexto\nA interface já oferece exportação JSON.');
    expect(prompt).toContain('## Entregável esperado');
    expect(prompt).toContain('## Restrições de escopo');
    expect(prompt).toContain('## Como apresentar o resultado');
    expect(prompt).toContain('não amplie o escopo por conta própria');
  });

  it('inclui orientação específica e mantém o limite próprio de cada modelo', () => {
    for (const template of TASK_TEMPLATES) {
      const prompt = buildTaskPrompt({
        templateId: template.id,
        objective: 'Tarefa de exemplo',
        context: '',
      });

      expect(prompt).toContain(template.guidance);
      for (const deliverable of template.expectedDeliverable) expect(prompt).toContain(deliverable);
      for (const constraint of template.scopeConstraints) expect(prompt).toContain(constraint);
      expect(prompt).toContain('Nenhum contexto adicional foi informado.');
    }

    expect(buildTaskPrompt({ templateId: 'code-review', objective: 'Revisar diff', context: '' }))
      .toContain('Faça revisão somente leitura');
    expect(buildTaskPrompt({ templateId: 'release-preparation', objective: 'Preparar versão', context: '' }))
      .toContain('Não faça commit, push, merge, publicação, deploy');
  });

  it('preserva o rascunho de cada modelo e atualiza o prompt sem perder o projeto', () => {
    const state = new TaskTemplateEditorState();
    state.setProject('Projeto Norte');
    state.setObjective('Mapear opções');
    state.setContext('Considere o trimestre atual.');

    state.selectTemplate('bug-fix');
    expect(state.canCopy).toBe(false);
    state.setObjective('Corrigir falha ao salvar');
    state.setContext('O erro aparece após enviar o formulário.');

    state.selectTemplate('research');
    expect(state.draft).toEqual({
      objective: 'Mapear opções',
      context: 'Considere o trimestre atual.',
    });
    expect(state.prompt).toContain('## Projeto\nProjeto Norte');

    state.selectTemplate('bug-fix');
    expect(state.draft).toEqual({
      objective: 'Corrigir falha ao salvar',
      context: 'O erro aparece após enviar o formulário.',
    });
    expect(state.prompt).toContain('## Objetivo\nCorrigir falha ao salvar');
  });

  it('habilita cópia somente com objetivo não vazio e não apaga rascunhos ao trocar o projeto', () => {
    const state = new TaskTemplateEditorState();
    expect(state.canCopy).toBe(false);
    state.setObjective('   \n');
    expect(state.canCopy).toBe(false);

    state.setObjective('Validar o fluxo de login');
    state.setContext('Usar o ambiente local.');
    state.setProject('Projeto Leste');
    expect(state.canCopy).toBe(true);
    expect(state.prompt).toContain('## Projeto\nProjeto Leste');

    state.setProject('Projeto Oeste');
    expect(state.draft).toEqual({
      objective: 'Validar o fluxo de login',
      context: 'Usar o ambiente local.',
    });
    expect(state.prompt).toContain('## Projeto\nProjeto Oeste');

    state.setObjective('');
    expect(state.canCopy).toBe(false);
  });
});
