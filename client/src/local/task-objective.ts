import type { AgentInfo } from '../../../shared/types';
import { sanitizeActivityText } from '../ui/feed-policy';

/** Use an explicit task or recent request; never infer an objective from tool names. */
export function taskObjective(agent: Pick<AgentInfo, 'tasks' | 'recent'>): { label: string; text: string } | null {
  const task = agent.tasks.find((item) => item.status === 'in_progress');
  if (task) {
    const text = sanitizeActivityText(task.activeForm || task.title).trim();
    if (text) return { label: 'Tarefa atual', text };
  }
  const prompt = [...agent.recent].reverse().find((item) => item.kind === 'prompt');
  if (!prompt?.detail) return null;
  const text = sanitizeActivityText(prompt.detail).trim();
  return text.length >= 3 ? { label: 'Pedido recente', text: text.slice(0, 260) } : null;
}
