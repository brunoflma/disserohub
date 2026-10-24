/** Estado público do instalador; caminhos e credenciais ficam somente no servidor. */
export type InstallPhase = 'idle' | 'preparing' | 'downloading' | 'dependencies' | 'building' | 'restarting' | 'done' | 'error' | 'rolled-back';

export interface UpdateInstallStatus {
  protocol?: 1;
  supported: boolean;
  reason?: string;
  phase: InstallPhase;
  target?: string;
  message?: string;
  startedAt?: number;
  updatedAt?: number;
}

export function installBusy(phase: InstallPhase): boolean {
  return ['preparing', 'downloading', 'dependencies', 'building', 'restarting'].includes(phase);
}
