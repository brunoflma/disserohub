import { describe, expect, it } from 'vitest';
import type { Activity } from '../../shared/types';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { MessageRegistry } from './registry';

describe('native questions never use the ordinary Codex message queue', () => {
  it.each(['request_user_input_async', 'functions.request_user_input_async', 'request_user_input'])('%s stays pending without queueing any reply', async tool => {
    let calls = 0;
    const id = 'question:codex';
    const office = new Office({ names: new NameStore(null), version: 'test', startedAt: 0,
      accounts: () => [], sources: () => [], accountName: () => undefined });
    office.addMain({ id, provider: 'codex', account: 'codex', sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: '/synthetic/question', role: 'Teste', startedAt: 0, status: 'waiting' });
    const activity: Activity = { id: `${id}#call`, at: 1, kind: 'ask', icon: '?', text: 'Teste', tool,
      questions: [{ index: 0, question: 'Continuar?', options: [] }] };
    office.setPendingQuestions(id, [activity]);
    const registry = new MessageRegistry({ office,
      codex: { homeOf: () => '/synthetic/account', run: async () => { calls++; return { ok: true }; } } });
    const body = { agentId: id, activityId: activity.id, answer: { question: 0, other: 'sim' } };
    for (let i = 0; i < 2; i++) expect(registry.answerQuestion(body)).toMatchObject({ error: 'unavailable' });
    expect(registry.size).toBe(0);
    expect(calls).toBe(0);
    expect(office.get(id)?.pendingQuestions).toEqual([activity]);
    expect(office.get(id)?.status).toBe('waiting');
    // Ordinary instructions still use their existing, explicitly queued transport.
    expect(registry.send({ agentId: id, text: 'Uma orientação comum' })).toHaveProperty('message');
    await Promise.resolve();
    expect(calls).toBe(1);
  });
});
