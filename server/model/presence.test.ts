import { describe, expect, it } from 'vitest';
import type { AgentStatus, PermissionRequestInfo, Provider } from '../../shared/types';
import { NameStore } from './names';
import { DONE_GRACE_MS, IDLE_PRESENCE_MS, Office, OFFLINE_GRACE_MS } from './office';

const MIN = 60_000;

function setup() {
  let clock = 1_800_000_000_000;
  const permissions = new Map<string, PermissionRequestInfo>();
  const office = new Office({
    names: new NameStore(null), version: 'test', startedAt: clock,
    accounts: () => [], sources: () => [], accountName: () => undefined,
    permissions: () => permissions, now: () => clock,
  });
  return {
    office, permissions, now: () => clock,
    advance(ms: number) { clock += ms; office.tick(); },
    add(id = 'main', status: AgentStatus = 'idle', since = clock, cwd = '/projetos/api', provider: Provider = 'claude') {
      office.addMain({ id, provider, status, statusSince: since, account: provider, sessionId: id,
        cwd, role: 'Agente principal', startedAt: since });
    },
    snapshot: () => office.commit().snapshot,
  };
}

describe('presença por atividade recente', () => {
  it.each(['claude', 'codex'] as const)('%s: retira após 15 min, conserva sessão e histórico e volta com trabalho novo', (provider) => {
    const c = setup();
    c.add('main', 'working', c.now(), '/projetos/api', provider);
    c.office.addActivity('main', { id: 'prompt', kind: 'prompt', text: 'Testar', icon: '💬', at: c.now() }, true);
    c.advance(MIN);
    c.office.setStatus('main', 'idle');
    const original = c.snapshot().agents[0];
    c.advance(15 * 60_000 - 1);
    expect(c.snapshot().agents).toHaveLength(1);
    c.advance(1);
    expect(c.office.commit()).toMatchObject({ changed: true, snapshot: { agents: [], rooms: [] } });
    expect(c.office.has('main')).toBe(true);
    expect(c.office.detail('main')?.history.some((a) => a.id === 'prompt')).toBe(true);
    c.advance(3 * 60 * MIN);
    c.office.setStatus('main', 'idle'); // Releitura, sem atividade: não reabre.
    expect(c.snapshot().agents).toEqual([]);
    c.office.setStatus('main', 'working');
    const resumed = c.snapshot();
    expect(resumed.agents[0]).toMatchObject({ id: original.id, name: original.name, status: 'working' });
    expect(resumed.rooms.map((r) => r.id)).toEqual(['/projetos/api']);
    expect(c.office.detail('main')?.history.some((a) => a.id === 'prompt')).toBe(true);
  });

  it('boot preserva o tempo real: três horas ocioso não recebem mais 15 minutos', () => {
    const c = setup();
    const old = c.now() - 3 * 60 * MIN;
    c.office.beginBoot();
    c.add('main', 'idle', old);
    c.office.addActivity('main', { id: 'done', kind: 'done', text: 'Concluiu', icon: '✅', at: old }, true);
    c.office.endBoot();
    expect(c.snapshot()).toMatchObject({ agents: [], rooms: [] });
    expect(c.office.get('main')?.statusSince).toBe(old);
    expect(c.office.commit().notices).toEqual([]);
  });

  it('atualizações atrasadas de conclusão ou de metadados não trazem um agente retirado de volta', () => {
    const c = setup();
    c.add();
    c.advance(IDLE_PRESENCE_MS);
    expect(c.snapshot().agents).toEqual([]);
    const activity = { id: 'done', kind: 'done' as const, text: 'Concluiu', icon: '✅', at: c.now() };
    c.office.addActivity('main', activity, true);
    expect(c.snapshot().agents).toEqual([]);
    c.office.applyTranscript('main', { tasks: [], stats: { toolCalls: 1, tokensIn: 100, tokensOut: 100, subagents: 0 }, lastAt: c.now() });
    expect(c.snapshot().agents).toEqual([]);
    c.advance(IDLE_PRESENCE_MS - 1);
    c.office.addActivity('main', activity, true);
    expect(c.snapshot().agents).toEqual([]);
    c.advance(1);
    expect(c.snapshot().agents).toEqual([]);
  });

  it('pausa ao vivo recebe 15 minutos inteiros, mesmo se o transcript tiver horários antigos', () => {
    const c = setup();
    c.add('main', 'working', c.now() - 3 * 60 * MIN);
    const pausedAt = c.now();
    c.office.setStatus('main', 'idle');
    expect(c.snapshot().agents[0]?.statusSince).toBe(pausedAt);
    c.advance(3_000);
    c.office.applyTranscript('main', { tasks: [], stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, lastAt: pausedAt - 3 * 60 * MIN });
    c.office.setStatus('main', 'idle');
    expect(c.snapshot().agents).toHaveLength(1);
    c.advance(IDLE_PRESENCE_MS - 3_001);
    expect(c.snapshot().agents).toHaveLength(1);
    c.advance(1);
    expect(c.snapshot().agents).toEqual([]);
    c.office.setStatus('main', 'working');
    c.advance(1_000);
    c.office.setStatus('main', 'idle');
    c.advance(3_000);
    expect(c.snapshot().agents).toHaveLength(1);
  });

  it.each(['working', 'waiting', 'shell'] as const)('mantém %s, mesmo após horas sem novos eventos', (status) => {
    const c = setup();
    c.add('main', status);
    c.advance(3 * 60 * MIN);
    expect(c.snapshot().agents[0]?.status).toBe(status);
    expect(c.snapshot().rooms).toHaveLength(1);
  });

  it('pedido pendente torna o agente visível; ao terminar recebe 15 minutos de descanso', () => {
    const c = setup();
    c.add();
    c.advance(IDLE_PRESENCE_MS);
    expect(c.snapshot().agents).toEqual([]);
    c.permissions.set('main', { id: 'p', tool: 'Bash', title: 'Bash(npm test)', text: 'Testar', icon: '🧪', createdAt: c.now(), expiresAt: c.now() + MIN });
    expect(c.snapshot().agents[0]?.status).toBe('waiting');
    expect(c.snapshot().rooms).toHaveLength(1);
    c.permissions.clear();
    expect(c.snapshot().agents).toHaveLength(1);
    c.advance(IDLE_PRESENCE_MS - 1);
    expect(c.snapshot().agents).toHaveLength(1);
    c.advance(1);
    expect(c.snapshot()).toMatchObject({ agents: [], rooms: [] });
  });

  it('subagentes trazem o principal de volta e o mantêm até acabar a animação de entrega', () => {
    const c = setup();
    c.add();
    c.advance(IDLE_PRESENCE_MS);
    expect(c.snapshot().agents).toEqual([]);
    c.office.addSub({ id: 'sub', parentId: 'main', sessionId: 'sub', role: 'Testar', background: false, startedAt: c.now() });
    c.office.addSub({ id: 'nested', parentId: 'sub', sessionId: 'nested', role: 'Revisar', background: false, startedAt: c.now() });
    c.advance(3 * 60 * MIN);
    expect(c.snapshot().agents.map((a) => a.id)).toEqual(['main', 'sub', 'nested']);
    c.office.completeSub('nested');
    c.office.completeSub('sub');
    expect(c.snapshot().agents).toHaveLength(3);
    c.advance(DONE_GRACE_MS);
    expect(c.snapshot().agents.map((a) => a.id)).toEqual(['main']);
    c.advance(IDLE_PRESENCE_MS - 1);
    expect(c.snapshot().agents).toHaveLength(1);
    c.advance(1);
    expect(c.snapshot()).toMatchObject({ agents: [], rooms: [] });
  });

  it('só oculta salas vazias; outra sessão em andamento mantém o projeto aberto', () => {
    const c = setup();
    c.add('old');
    c.add('busy', 'working');
    c.add('other', 'idle', c.now(), '/projetos/velho');
    c.advance(IDLE_PRESENCE_MS);
    expect(c.snapshot().agents.map((a) => a.id)).toEqual(['busy']);
    expect(c.snapshot().rooms.map((r) => r.id)).toEqual(['/projetos/api']);
  });

  it('fechar uma sessão já retirada não faz o agente ou a sala reaparecerem', () => {
    const c = setup();
    c.add();
    c.advance(IDLE_PRESENCE_MS);
    expect(c.snapshot()).toMatchObject({ agents: [], rooms: [] });
    c.office.closeMain('main');
    expect(c.snapshot()).toMatchObject({ agents: [], rooms: [] });
    c.advance(OFFLINE_GRACE_MS);
    expect(c.office.has('main')).toBe(false);
    expect(c.snapshot()).toMatchObject({ agents: [], rooms: [] });
  });
});
