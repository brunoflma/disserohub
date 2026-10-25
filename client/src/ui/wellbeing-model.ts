export type WellbeingPeriod = 'day' | 'week' | 'month';
export const PERIOD_LABELS: Record<WellbeingPeriod, string> = { day: 'Hoje', week: 'Esta semana', month: 'Este mês' };
export function wellbeingDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 60_000);
  if (!minutes) return ms > 0 ? 'menos de 1 min' : '0 min';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
}
export function activityRecent(lastInteraction: number, now: number, focused: boolean, visible: boolean, enabled: boolean): boolean {
  return enabled && focused && visible && now >= lastInteraction && now - lastInteraction < 120_000;
}
export function chartWidth(value: number, max: number): string {
  return `${Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0))}%`;
}
