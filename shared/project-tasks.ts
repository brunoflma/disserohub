/** Manual project work, independent of tasks inferred from an agent's transcript. */
export type ProjectTaskStatus = 'todo' | 'doing' | 'blocked' | 'review' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';
export interface TaskDelivery {
  id: string;
  sessionId: string;
  headline: string;
  finishedAt: number;
  fingerprint: string;
}
export interface TaskReview {
  id: string;
  at: number;
  verdict: 'accepted' | 'changes_requested';
  note: string;
  criteria: string[];
  delivery: TaskDelivery;
}
export interface ProjectTask {
  id: string;
  projectId: string;
  projectPath: string;
  title: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  status: ProjectTaskStatus;
  criteria: string[];
  dependsOn: string[];
  reviews: TaskReview[];
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface TaskDraft {
  title: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  status: Exclude<ProjectTaskStatus, 'done'>;
  criteria: string[];
  dependsOn: string[];
}
export const taskStatusLabels: Record<ProjectTaskStatus, string> = {
  todo: 'A fazer', doing: 'Em andamento', blocked: 'Bloqueada', review: 'Em revisão', done: 'Concluída',
};
export function projectPathKey(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(clean) || clean.startsWith('//') ? clean.toLowerCase() : clean;
}
