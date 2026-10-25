import type { WellbeingPreferences, WellbeingReport } from '../../../shared/wellbeing';

export type WellbeingAction = 'pause' | 'resume' | 'snooze' | 'ack';
export class WellbeingClient {
  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init), private readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, readonly clientId = crypto.randomUUID()) {}
  private async request<T>(suffix = '', body?: unknown): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(`/api/wellbeing${suffix}?tz=${encodeURIComponent(this.timeZone)}`, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      cache: 'no-store', signal: AbortSignal.timeout(8_000),
    }); } catch { throw new Error('Não foi possível conectar ao acompanhamento. Tente novamente.'); }
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof data?.error === 'string' ? data.error.slice(0, 200) : 'Não foi possível consultar o acompanhamento. Tente novamente.');
    }
    try { return await response.json() as T; }
    catch { throw new Error('O acompanhamento enviou uma resposta incompleta. Tente novamente.'); }
  }
  snapshot(): Promise<WellbeingReport> { return this.request(); }
  pulse(active: boolean): Promise<{ ok: boolean }> { return this.request('/pulse', { active, clientId: this.clientId }); }
  configure(preferences: Partial<WellbeingPreferences>): Promise<WellbeingReport> { return this.request('/preferences', preferences); }
  action(action: WellbeingAction, id?: string): Promise<WellbeingReport> { return this.request('/action', { action, ...(id ? { id } : {}) }); }
}
