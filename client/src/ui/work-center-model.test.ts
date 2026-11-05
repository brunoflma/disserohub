import { describe, expect, it } from 'vitest';
import type { AccessInfo, Activity, AgentInfo, OfficeSnapshot } from '../../../shared/types';
import { ATTENTION_WINDOW_MS, collectWorkAttention, summarizeWorkProject, workIntegrations } from './work-center-model';

const now = 1_800_000_000_000;
const question = (id = 'question-1'): Activity => ({ id, kind: 'ask', icon: '?', text: 'Pergunta', at: now - 2_000,
  questions: [{ index: 0, question: 'Qual formato usar?', options: [{ index: 0, label: 'PDF' }] }] });
const request = (overrides: Partial<NonNullable<AgentInfo['permission']>> = {}): NonNullable<AgentInfo['permission']> => ({
  id: 'request-1', tool: 'Bash', title: 'Executar verificação?', text: 'Verificar o projeto', icon: '?', createdAt: now - 1_000, expiresAt: now + 10_000, ...overrides,
});
const agent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 'claude:one', kind: 'main', roomId: 'project-a', name: 'Ana', look: 'f', role: 'Agente', sessionId: 'session-a', account: 'claude',
  status: 'working', recent: [], tasks: [], startedAt: now - 30_000, lastEventAt: now - 1_000, statusSince: now - 5_000, seed: 1,
  stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, ...overrides,
});
const snapshot = (agents: AgentInfo[] = []): OfficeSnapshot => ({ rev: 1, serverTime: now, agents, accounts: [],
  rooms: [{ id: 'project-a', name: 'Projeto A', path: 'D:\\Projetos\\A', slot: 0, seed: 1, createdAt: now - 100_000 }],
  meta: { demo: false, startedAt: now - 100_000, version: 'test', terminal: true, messages: true,
    sources: [{ label: 'claude', path: 'synthetic', sessions: 0, ok: true }] },
});
const access: AccessInfo = { remote: false, local: true, permissions: true, messages: true, terminal: true, spawn: false };

describe('Central de trabalho: atenção', () => {
  it('includes asynchronous Codex questions while the agent is working', () => {
    const a = agent({ provider: 'codex', pendingQuestions: [question()] });
    expect(collectWorkAttention([a], now)).toMatchObject([{ kind: 'question', text: 'Qual formato usar?', permission: false }]);
  });
  it('keeps separate questions but deduplicates a question repeated in current activity', () => {
    const q = question();
    const items = collectWorkAttention([agent({ status: 'waiting', activity: q, pendingQuestions: [q, question('question-2')] })], now);
    expect(items).toHaveLength(2);
    expect(new Set(items.map(i => i.id)).size).toBe(2);
  });
  it('opens the existing direct question card without duplicating its transcript', () => {
    const q = question();
    const items = collectWorkAttention([agent({ status: 'waiting', activity: q, permission: request({ channel: 'direct', questions: q.questions }) })], now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'question', permission: true });
  });
  it('keeps separate native and direct requests even when their wording is identical', () => {
    const q = question();
    const items = collectWorkAttention([agent({ pendingQuestions: [q], permission: request({ channel: 'direct', questions: q.questions }) })], now);
    expect(items).toHaveLength(2);
    expect(items.filter(item => item.permission)).toHaveLength(1);
  });
  it('never exposes expired requests or ended sessions as actionable questions', () => {
    expect(collectWorkAttention([agent({ permission: request({ expiresAt: now }) })], now)).toEqual([]);
    for (const status of ['done', 'offline'] as const) expect(collectWorkAttention([agent({ status, permission: request(), pendingQuestions: [question()] })], now)).toEqual([]);
    expect(collectWorkAttention([agent({ status: 'waiting', permission: request({ expiresAt: now - 1 }) })], now)[0]).toMatchObject({ kind: 'waiting', permission: false });
  });
  it('prioritizes permission and oldest questions before generic waits and recent errors', () => {
    const error: Activity = { id: 'err', kind: 'error', icon: '!', text: 'Falha confirmada', at: now - 500 };
    const items = collectWorkAttention([
      agent({ id: 'wait', status: 'waiting' }), agent({ id: 'err', recent: [error] }),
      agent({ id: 'q-new', pendingQuestions: [question()] }), agent({ id: 'perm', permission: request() }),
      agent({ id: 'q-old', pendingQuestions: [{ ...question(), at: now - 9_000 }] }),
    ], now);
    expect(items.map(i => i.agent.id)).toEqual(['perm', 'q-old', 'q-new', 'wait', 'err']);
  });
  it('uses structured errors and excludes old, future and invalid timestamps', () => {
    const error: Activity = { id: 'err', kind: 'error', icon: '!', text: 'Falha', at: now - 1 };
    expect(collectWorkAttention([agent({ activity: error, recent: [error] })], now)).toHaveLength(1);
    const old = { ...error, at: now - ATTENTION_WINDOW_MS - 1 };
    expect(collectWorkAttention([agent({ recent: [old, { ...error, at: now + 1 }, { ...error, at: NaN }, { ...error, kind: 'read', text: 'error.log' }] })], now)).toEqual([]);
  });
});

describe('Central de trabalho: projeto', () => {
  it('preserves registered projects with no sessions', () => {
    const result = summarizeWorkProject(snapshot(), 'project-a', now);
    expect(result).toMatchObject({ sessions: 0, working: 0, agents: [], tasks: [], attention: [] });
    expect(result.objective).toBeUndefined();
  });
  it('counts main sessions separately from subagents and filters other projects', () => {
    const result = summarizeWorkProject(snapshot([agent(), agent({ id: 'sub', kind: 'sub', parentId: 'claude:one' }),
      agent({ id: 'other', roomId: 'project-b' }), agent({ id: 'closed', status: 'offline' })]), 'project-a', now);
    expect(result.sessions).toBe(1); expect(result.working).toBe(2); expect(result.agents).toHaveLength(3);
  });
  it('takes the objective from explicit tasks and never infers successful tests from text', () => {
    const a = agent({ tasks: [{ id: 't', title: 'Corrigir filtros', status: 'in_progress' }],
      recent: [{ id: 'r', kind: 'read', icon: '', text: 'vitest passou build concluído', at: now - 1 }] });
    const result = summarizeWorkProject(snapshot([a]), 'project-a', now);
    expect(result.objective?.text).toBe('Corrigir filtros'); expect(result.nextTask?.task.id).toBe('t'); expect(result.latest).toBeUndefined();
  });
});

describe('Central de trabalho: integrações', () => {
  it('a readable source without sessions does not imply a connected message bridge', () => {
    const [claude] = workIntegrations(snapshot(), access, false, true, now);
    expect(claude.state).toBe('Fonte disponível, sem sessão observada');
    expect(claude.capabilities.find(c => c.label === 'Mensagens')?.value).toBe('Aguardando canal de uma sessão');
  });
  it('honors current page rights even when a session advertises a channel', () => {
    const [claude] = workIntegrations(snapshot([agent({ canMessage: true, permission: request() })]), { ...access, messages: false, permissions: false, terminal: false }, false, true, now);
    expect(claude.capabilities.slice(0, 3).map(c => c.value)).toEqual(['Não permitidas nesta página', 'Não permitidas nesta página', 'Não disponíveis nesta página']);
  });
  it('does not promise current availability on disconnect or replay', () => {
    for (const [replaying, connected] of [[true, true], [false, false]]) {
      const [claude] = workIntegrations(snapshot([agent({ canMessage: true })]), access, replaying, connected, now);
      expect(claude.capabilities[0].value).toBe('Disponibilidade atual não confirmada');
      expect(claude.capabilities[1].value).toBe('Somente consulta');
    }
  });
  it('reports errors without hiding another healthy source and keeps Codex terminal distinct', () => {
    const snap = snapshot(); snap.meta.sources.push({ label: 'conta-2', path: 'synthetic-2', sessions: 0, ok: false, error: 'Pasta indisponível' });
    snap.meta.pty = { enabled: true };
    const [claude, codex] = workIntegrations(snap, access, false, true, now);
    expect(claude.state).toBe('Uma fonte precisa de atenção'); expect(claude.details[1]).toContain('Pasta indisponível');
    expect(codex.capabilities.find(c => c.label === 'Terminal interativo')?.value).toBe('Use o cliente de origem');
  });
});
