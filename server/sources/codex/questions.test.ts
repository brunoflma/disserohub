import { describe, expect, it } from 'vitest';
import { CodexQuestions, codexQuestionDescription } from './questions';

const asyncTool = 'request_user_input_async';
const questions = { questions: [{ title: 'Pode verificar o navegador?' }, { title: 'Qual caminho seguir?', options: ['Continuar', 'Parar'] }] };
const reply = (call: string, ...indices: number[]) => `<send_user_message_question_reply>\n${JSON.stringify(indices.map((i) => ({ questionItemId: JSON.stringify([asyncTool, call, i]), answer: 'ok' })))}\n</send_user_message_question_reply>`;

describe('perguntas pendentes do Codex', () => {
  it('normaliza pergunta livre/alternativas do app e pergunta bloqueante, sem confundir outras ferramentas', () => {
    expect(codexQuestionDescription(asyncTool, questions)).toMatchObject({ kind: 'ask', questions: [{ index: 0, question: 'Pode verificar o navegador?', options: [] }, { index: 1, options: [{ index: 0, label: 'Continuar' }, { index: 1, label: 'Parar' }] }] });
    expect(codexQuestionDescription('functions.request_user_input', { questions: [{ question: 'Qual banco?', header: 'Banco', options: [{ label: 'SQLite', description: 'Local' }] }] })?.questions?.[0]).toMatchObject({ header: 'Banco', options: [{ label: 'SQLite', description: 'Local' }] });
    expect(codexQuestionDescription('mcp__other__request_user_input_async', questions)).toBeUndefined();
    expect(codexQuestionDescription(asyncTool, { questions: [{ title: '' }, null] })).toBeUndefined();
  });

  it('confirmação de criação não apaga cartões assíncronos; resposta parcial mantém o restante', () => {
    const q = new CodexQuestions();
    expect(q.start('ask', asyncTool, questions, 1, 'agent')).toBe(true);
    expect(q.complete('ask', '{"accepted":true}')).toBe(false);
    expect(q.waiting).toBe(true);
    expect(q.reply(reply('ask', 0))).toBe(true);
    expect(q.activities()[0].questions?.map((x) => x.index)).toEqual([1]);
    expect(q.reply(reply('ask', 0))).toBe(false);
    expect(q.start('ask', asyncTool, questions, 1, 'agent')).toBe(false);
    expect(q.reply(reply('ask', 1))).toBe(true);
    expect(q.waiting).toBe(false);
    expect(q.start('ask', asyncTool, questions, 1, 'agent')).toBe(false);
  });

  it('aceita a resposta unitária do app sem apagar outras perguntas', () => {
    const q = new CodexQuestions();
    q.start('ask', asyncTool, questions, 1, 'agent');
    const text = `<send_user_message_question_reply>${JSON.stringify({ questionItemId: JSON.stringify([asyncTool, 'ask', 0]), answer: 'ok' })}</send_user_message_question_reply>`;
    expect(q.reply(text)).toBe(true);
    expect(q.activities()[0].questions?.map((x) => x.index)).toEqual([1]);
  });

  it('encerra cartões do turno concluído sem apagar perguntas de um turno mais novo', () => {
    const q = new CodexQuestions();
    q.start('old', asyncTool, questions, 1, 'agent');
    q.start('new', asyncTool, questions, 3, 'agent');
    q.endTurn(2);
    expect(q.activities().map((x) => x.id)).toEqual(['agent#new']);
    expect(q.start('old', asyncTool, questions, 1, 'agent')).toBe(false);
    q.endTurn(4);
    expect(q.waiting).toBe(false);
  });

  it('uma resposta não apaga outra chamada pendente; pular também encerra a pergunta identificada', () => {
    const q = new CodexQuestions();
    q.start('a', asyncTool, questions, 1, 'agent');
    q.start('b', asyncTool, questions, 2, 'agent');
    q.reply(reply('a', 0, 1));
    expect(q.activities().map((x) => x.id)).toEqual(['agent#b']);
    // O identificador resolve a pergunta; o conteúdo da resposta não é necessário ao monitor.
    q.reply(`<send_user_message_question_reply>${JSON.stringify([0, 1].map((i) => ({ questionItemId: JSON.stringify([asyncTool, 'b', i]), answer: '' })))}</send_user_message_question_reply>`);
    expect(q.waiting).toBe(false);
  });

  it('resposta de pergunta bloqueante, cancelamento e falha da ferramenta retiram a espera', () => {
    const q = new CodexQuestions();
    q.start('sync', 'request_user_input', { questions: [{ question: 'Continuar?' }] }, 1, 'agent');
    expect(q.complete('sync', '{"answers":{}}')).toBe(true);
    q.start('cancel', 'request_user_input', { questions: [{ question: 'Continuar?' }] }, 2, 'agent');
    q.endTurn(3);
    expect(q.waiting).toBe(false);
    q.start('failure', asyncTool, questions, 4, 'agent');
    expect(q.complete('failure', 'Error: unavailable')).toBe(true);
  });

  it('prefixo antigo restaura só perguntas ainda pendentes e respeita respostas/resultados da janela final', () => {
    const prefix = new CodexQuestions();
    for (const id of ['pending', 'answered', 'failed', 'partial']) prefix.start(id, asyncTool, questions, 1, 'agent');
    prefix.start('sync', 'request_user_input', { questions: [{ question: 'Continuar?' }] }, 0, 'agent');
    prefix.start('older', asyncTool, questions, 0, 'agent');
    const tail = new CodexQuestions();
    tail.reply(reply('answered', 0, 1));
    tail.reply(reply('partial', 1));
    tail.complete('failed', '{"accepted":false}');
    tail.complete('pending', '{"accepted":true}');
    tail.endTurn(0);
    expect(tail.merge(prefix)).toBe(true);
    expect(tail.activities().map((x) => [x.id, x.questions?.map((q) => q.index)])).toEqual([['agent#pending', [0, 1]], ['agent#partial', [0]]]);
    expect(tail.merge(prefix)).toBe(false);
  });

  it('respostas do prefixo encerram chamadas duplicadas na janela final', () => {
    const prefix = new CodexQuestions();
    const tail = new CodexQuestions();
    for (const id of ['answered', 'partial', 'pending']) {
      prefix.start(id, asyncTool, questions, 1, 'agent');
      tail.start(id, asyncTool, questions, 1, 'agent');
    }
    prefix.reply(reply('answered', 0, 1));
    prefix.reply(reply('partial', 0));
    expect(tail.merge(prefix)).toBe(true);
    expect(tail.activities().map((x) => [x.id, x.questions?.map((q) => q.index)])).toEqual([['agent#partial', [1]], ['agent#pending', [0, 1]]]);
    expect(tail.start('answered', asyncTool, questions, 1, 'agent')).toBe(false);
  });

  it('conclusão no prefixo e confirmação duplicada não recriam cartões cancelados', () => {
    const prefix = new CodexQuestions();
    const tail = new CodexQuestions();
    prefix.start('ended', asyncTool, questions, 1, 'agent');
    prefix.endTurn(2);
    tail.start('ended', asyncTool, questions, 1, 'agent');
    tail.start('fresh', asyncTool, questions, 3, 'agent');
    expect(tail.merge(prefix)).toBe(true);
    expect(tail.activities().map((x) => x.id)).toEqual(['agent#fresh']);
    tail.complete('failed', 'Error: unavailable');
    tail.complete('failed', '{"accepted":true}');
    expect(tail.start('failed', asyncTool, questions, 3, 'agent')).toBe(false);
  });

  it('ignora envelopes inválidos e mascara segredos antes de levar perguntas ao cliente', () => {
    const q = new CodexQuestions();
    q.start('a', asyncTool, { questions: [{ title: 'Usar token ghp_abcdefghijklmnopqrstuvwxyz1234567890AB?' }] }, 1, 'agent');
    expect(JSON.stringify(q.activities())).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890AB');
    for (const text of ['<send_user_message_question_reply>invalid</send_user_message_question_reply>', reply('a', -1), reply('a', 4), `texto ${reply('a', 0)}`, '<send_user_message_question_reply>[]</send_user_message_question_reply>']) expect(q.reply(text)).toBe(false);
    expect(q.waiting).toBe(true);
  });
});
