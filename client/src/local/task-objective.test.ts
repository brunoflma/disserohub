import { describe, expect, it } from 'vitest';
import { taskObjective } from './task-objective';
describe('task objective evidence', () => {
  it('prefers an explicit active task over an old conversation request', () => {
    expect(taskObjective({ tasks: [{ id: '1', title: 'Atualizar o feed', activeForm: 'Agrupando eventos', status: 'in_progress' }], recent: [{ id: 'p', kind: 'prompt', icon: '', text: 'Recebeu...', detail: 'Mudar o fundo', at: 1 }] })).toEqual({ label: 'Tarefa atual', text: 'Agrupando eventos' });
  });
  it('uses a recent human request and never guesses a task from tools', () => {
    expect(taskObjective({ tasks: [], recent: [{ id: 'p', kind: 'prompt', icon: '', text: 'Recebeu...', detail: 'Melhorar a navegação', at: 1 }] })).toEqual({ label: 'Pedido recente', text: 'Melhorar a navegação' });
    expect(taskObjective({ tasks: [], recent: [{ id: 't', kind: 'run', icon: '', text: 'Executando npm', detail: 'npm run build', at: 2 }] })).toBeNull();
  });
});
