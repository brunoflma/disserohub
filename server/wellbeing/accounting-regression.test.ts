import { describe, expect, it } from 'vitest';
import { WellbeingService } from './service';

const MINUTE = 60_000;
function setup() {
  let now = Date.UTC(2026, 10, 4, 12);
  const focus = { supported: true, active: true, idleMs: 0, sampledAt: now };
  const service = new WellbeingService({ file: null, now: () => now, agentsActive: () => true, desktop: () => focus });
  service.load(); service.sample();
  return { service, focus,
    sampleFor(minutes: number) { for (let i = 0; i < minutes * MINUTE / 5000; i++) { now += 5000; focus.sampledAt = now; service.sample(); } },
    advance(ms: number, sample = true) { now += ms; if (sample) { focus.sampledAt = now; service.sample(); } return service.snapshot('UTC'); } };
}
describe('wellbeing accounting regressions', () => {
  it('frequent dashboard reads cannot extend expired observations while the sampler is absent', () => {
    const h = setup();
    for (let i = 0; i < 30; i++) h.advance(1000, false);
    const report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(15_000);
    expect(report.periods.day.personalCoverageMs).toBe(15_000);
    expect(report.periods.day.agentMs).toBe(10_000);
    expect(report.periods.day.coverageMs).toBe(10_000);
  });
  it('clips personal activity at the actual idle deadline inside a sample interval', () => {
    const h = setup(); h.focus.idleMs = 119_000; h.service.sample();
    const report = h.advance(5000, false);
    expect(report.periods.day.personalMs).toBe(1000);
    expect(report.periods.day.agentMs).toBe(5000);
  });
  it('uses the same two-minute inactivity threshold as the Windows monitor', () => {
    const h = setup(); h.focus.idleMs = 120_001; h.service.sample();
    expect(h.advance(5000).periods.day.personalMs).toBe(0);
  });
  it('shows the daily high-use warning even when a continuous break is also due', () => {
    const h = setup(); h.service.configure({ breakAfterMinutes: 25, dailyLimitMinutes: 120 });
    h.sampleFor(25);
    expect(h.service.snapshot('UTC').reminder?.kind).toBe('break');
    h.sampleFor(95);
    const report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(120 * MINUTE);
    expect(report.reminder?.kind).toBe('daily');
  });
});
