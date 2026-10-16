import { describe, expect, it } from 'vitest';
import type { Activity } from '../../shared/types';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import type { CodexQueueResult } from './codex';
import { MessageRegistry } from './registry';

function setup() {
  let now = 1_000;
  let finish!: (result: CodexQueueResult) => void;
  let calls = 0;
  const id = 'question:codex';
  const office = new Office({ names: new NameStore(null), version: 'test', startedAt: 0,
    accounts: () => [], sources: () => [], accountName: () => undefined, now: () => now });
  office.addMain({ id, provider: 'codex', account: 'codex', sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: '/synthetic/question', role: 'Teste', startedAt: 0, status: 'waiting' });
  const activity: Activity = { id: `${id}#call`, at: 1, kind: 'ask', icon: '?', text: 'Teste', tool: 'request_user_input_async',
    questions: [{ index: 0, question: 'Continuar?', options: [] }] };
  office.setPendingQuestions(id, [activity]);
  const registry = new MessageRegistry({ office, now: () => now, sentTimeoutMs: 10, keepMs: 20,
    codex: { homeOf: () => '/synthetic/account', run: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } });
  const body = (other = 'sim') => ({ agentId: id, activityId: activity.id, answer: { question: 0, other } });
  const advance = (ms: number) => { now += ms; registry.tick(); };
  return { office, registry, id, body, advance, calls: () => calls, finish: (r: CodexQueueResult) => finish(r) };
}

describe('question reply receipts after uncertain delivery', () => {
  it('keeps the same receipt across timeouts, retention expiry and a late successful delivery', async () => {
    const f = setup();
    const first = f.registry.answerQuestion(f.body());
    if (!('message' in first)) throw new Error('expected receipt');
    f.advance(11);
    expect(f.registry.get(first.message.id)?.status).toBe('failed');
    f.advance(30);
    expect(f.registry.answerQuestion(f.body())).toMatchObject({ message: { id: first.message.id, status: 'failed' } });
    expect(f.registry.answerQuestion(f.body('outra'))).toMatchObject({ error: 'unavailable' });
    expect(f.calls()).toBe(1);
    f.finish({ ok: true });
    await Promise.resolve();
    expect(f.registry.get(first.message.id)?.status).toBe('delivered');
    expect(f.registry.answerQuestion(f.body())).toMatchObject({ message: { id: first.message.id } });
    expect(f.calls()).toBe(1);
    f.office.setPendingQuestions(f.id, []);
    f.advance(21);
    expect(f.registry.get(first.message.id)).toBeUndefined();
    expect(f.registry.answerQuestion(f.body())).toMatchObject({ error: 'unavailable' });
  });

  it('does not replay a failed queue operation while its question remains pending', async () => {
    const f = setup();
    const first = f.registry.answerQuestion(f.body());
    if (!('message' in first)) throw new Error('expected receipt');
    f.finish({ ok: false, error: 'outcome unknown' });
    await Promise.resolve();
    f.advance(30);
    expect(f.registry.answerQuestion(f.body())).toMatchObject({ message: { id: first.message.id, status: 'failed' } });
    expect(f.calls()).toBe(1);
  });
});
