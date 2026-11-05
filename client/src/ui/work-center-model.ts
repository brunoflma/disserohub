import type { AccessInfo, Activity, AgentInfo, OfficeSnapshot, Provider } from '../../../shared/types';
import { taskObjective } from '../local/task-objective';
import { sanitizeActivityText } from './feed-policy';

export const ATTENTION_WINDOW_MS = 10 * 60_000;
export type WorkAttentionKind = 'permission' | 'question' | 'waiting' | 'error';
export interface WorkAttention {
  id: string;
  agent: AgentInfo;
  kind: WorkAttentionKind;
  text: string;
  since: number;
  /** Only a live permission request may open the existing response card. */
  permission: boolean;
}
const priority: Record<WorkAttentionKind, number> = { permission: 0, question: 1, waiting: 2, error: 3 };
export const workText = (value: string): string => sanitizeActivityText(value).slice(0, 800);
const validTime = (value: number, now: number): number => Number.isFinite(value) && value > 0 && value <= now ? value : now;

/** Consume explicit structured state, including questions raised while work continues. */
export function collectWorkAttention(agents: readonly AgentInfo[], now: number): WorkAttention[] {
  const result: WorkAttention[] = [];
  for (const agent of agents) {
    const active = agent.status !== 'done' && agent.status !== 'offline';
    const request = active && agent.permission && agent.permission.expiresAt > now ? agent.permission : undefined;
    const questions = new Map<string, Activity>();
    if (active) {
      for (const activity of agent.pendingQuestions ?? []) if (activity.questions?.length) questions.set(activity.id, activity);
      if (!request && agent.status === 'waiting' && agent.activity?.kind === 'ask' && agent.activity.questions?.length) questions.set(agent.activity.id, agent.activity);
    }
    if (request) {
      result.push({ id: `${agent.id}:request:${request.id}`, agent, kind: request.questions?.length ? 'question' : 'permission',
        text: workText(request.questions?.map(q => q.question).join(' · ') || request.title || request.text),
        since: validTime(request.createdAt, now), permission: true });
    }
    for (const activity of questions.values()) result.push({ id: `${agent.id}:question:${activity.id}`, agent, kind: 'question',
      text: workText(activity.questions!.map(q => q.question).join(' · ')), since: validTime(activity.at, now), permission: false });
    if (active && agent.status === 'waiting' && !request && !questions.size) result.push({ id: `${agent.id}:waiting`, agent,
      kind: 'waiting', text: workText(agent.waitingFor || 'A sessão está aguardando uma ação. Abra os detalhes para conferir.'),
      since: validTime(agent.statusSince, now), permission: false });
    const error = [...agent.recent, ...(agent.activity ? [agent.activity] : [])]
      .filter(a => (a.kind === 'error' || a.error === true) && Number.isFinite(a.at) && a.at <= now && a.at >= now - ATTENTION_WINDOW_MS)
      .sort((a, b) => b.at - a.at)[0];
    if (error) result.push({ id: `${agent.id}:error:${error.id}`, agent, kind: 'error', text: workText(error.detail || error.text), since: error.at, permission: false });
  }
  return result.sort((a, b) => priority[a.kind] - priority[b.kind] || a.since - b.since || a.id.localeCompare(b.id));
}

export function summarizeWorkProject(snapshot: OfficeSnapshot, roomId: string, now: number) {
  const agents = snapshot.agents.filter(a => a.roomId === roomId).sort((a, b) => b.lastEventAt - a.lastEventAt || a.id.localeCompare(b.id));
  const active = agents.filter(a => a.status !== 'done' && a.status !== 'offline');
  const tasks = active.flatMap(agent => agent.tasks.map(task => ({ agent, task })));
  const objectiveAgent = active.find(a => a.tasks.some(t => t.status === 'in_progress'))
    ?? active.find(a => (a.status === 'working' || a.status === 'shell') && taskObjective(a))
    ?? active.find(a => taskObjective(a));
  const latest = agents.flatMap(agent => [...agent.recent, ...(agent.activity ? [agent.activity] : [])].map(activity => ({ agent, activity })))
    .filter(({ activity }) => activity.kind === 'done' && Number.isFinite(activity.at) && activity.at <= now)
    .sort((a, b) => b.activity.at - a.activity.at)[0];
  return { agents, tasks, attention: collectWorkAttention(agents, now),
    sessions: active.filter(a => a.kind === 'main').length,
    working: active.filter(a => a.status === 'working' || a.status === 'shell').length,
    objective: objectiveAgent && taskObjective(objectiveAgent) ? { agent: objectiveAgent, ...taskObjective(objectiveAgent)! } : undefined,
    nextTask: tasks.find(({ task }) => task.status === 'in_progress') ?? tasks.find(({ task }) => task.status === 'pending'),
    latest,
  };
}

export interface WorkCapability { label: string; value: string; }
export interface WorkIntegration { provider: Provider; title: string; state: string; details: string[]; capabilities: WorkCapability[]; }

/** Availability is evidence from this page and snapshot, never a claim of a tested bridge. */
export function workIntegrations(snapshot: OfficeSnapshot, access: AccessInfo, replaying: boolean, connected: boolean, now: number): WorkIntegration[] {
  const historical = replaying || snapshot.meta.demo;
  const live = !historical && connected;
  return (['claude', 'codex'] as const).map(provider => {
    const sources = snapshot.meta.sources.filter(s => (s.provider ?? 'claude') === provider);
    const agents = snapshot.agents.filter(a => (a.provider ?? 'claude') === provider && a.status !== 'done' && a.status !== 'offline');
    const messageCount = agents.filter(a => a.kind === 'main' && a.canMessage).length;
    const requests = agents.filter(a => a.permission && a.permission.expiresAt > now);
    const restricted = historical ? 'Consulta de dados demonstrativos ou históricos' : !connected ? 'Sem conexão atual; último estado recebido' : '';
    return {
      provider, title: provider === 'claude' ? 'Claude Code' : 'Codex',
      state: restricted || (sources.some(s => !s.ok) ? 'Uma fonte precisa de atenção' : agents.length ? `${agents.length} sessão(ões) observada(s)`
        : sources.some(s => s.ok) ? 'Fonte disponível, sem sessão observada' : 'Nenhuma fonte observada'),
      details: sources.map(s => `${workText(s.label)}: ${s.ok ? `${s.sessions} sessão(ões)` : workText(s.error || 'Falha ao ler a fonte')}`),
      capabilities: [
        { label: 'Mensagens', value: !live ? 'Disponibilidade atual não confirmada' : !access.messages ? 'Não permitidas nesta página'
          : !snapshot.meta.messages ? 'Desativadas no servidor' : messageCount ? `Canal disponível em ${messageCount} sessão(ões)` : 'Aguardando canal de uma sessão' },
        { label: 'Perguntas e permissões', value: !live ? 'Somente consulta' : !access.permissions ? 'Não permitidas nesta página'
          : requests.length ? `${requests.length} pedido(s) com cartão de resposta` : 'Nenhum pedido conectado neste momento' },
        { label: 'Histórico e terminal de leitura', value: !live ? 'Disponibilidade atual não confirmada'
          : access.terminal && snapshot.meta.terminal ? 'Disponíveis nesta página' : 'Não disponíveis nesta página' },
        { label: 'Terminal interativo', value: !live ? 'Disponibilidade atual não confirmada' : provider === 'codex' ? 'Use o cliente de origem'
          : access.terminal && snapshot.meta.pty?.enabled ? 'Habilitado no servidor' : workText(snapshot.meta.pty?.reason || 'Não habilitado') },
        { label: 'Uso da conta', value: snapshot.accounts.some(a => (a.provider ?? 'claude') === provider && a.usage) ? 'Dados recebidos; confira a atualização na barra superior' : 'Sem dados de uso recebidos' },
      ],
    };
  });
}
