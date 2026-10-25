import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WELLBEING_BROWSER_LEASE_MS, WELLBEING_SAMPLE_MS } from '../../shared/wellbeing';
import { tempDir } from '../test/fixtures';
import { WellbeingService } from './service';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const T0 = Date.UTC(2026, 9, 25, 10);
const CLIENT = '00000000-0000-4000-8000-000000000003';
const temps: Array<{ cleanup: () => void }> = [];

afterEach(() => temps.splice(0).forEach((temp) => temp.cleanup()));

function setup(at = T0, file: string | null = null) {
  const clock = { now: at };
  const focus = { supported: true, active: false, idleMs: 0, sampledAt: at };
  const agents = { active: false };
  const service = new WellbeingService({
    file,
    now: () => clock.now,
    desktop: () => ({ ...focus, sampledAt: clock.now }),
    agentsActive: () => agents.active,
  });
  service.load();
  const sample = (next: number) => {
    clock.now = next;
    focus.sampledAt = next;
    service.sample(next);
  };
  return { clock, focus, agents, service, sample };
}

describe('WellbeingService edge regressions', () => {
  it('keeps daily reminder claims separate across local midnight and client time zones', () => {
    const h = setup();
    h.focus.active = true;
    h.service.configure({ breakAfterMinutes: 180, dailyLimitMinutes: 30 }, 'Etc/GMT+12');
    h.sample(T0);
    for (let i = 1; i <= (30 * MINUTE) / WELLBEING_SAMPLE_MS; i++) {
      h.sample(T0 + i * WELLBEING_SAMPLE_MS);
    }

    const beforeLocalMidnight = h.service.snapshot('Etc/GMT+12').reminder;
    expect(beforeLocalMidnight?.kind).toBe('daily');
    const westClaim = h.service.action('ack', beforeLocalMidnight!.id, 'Etc/GMT+12');
    expect(westClaim.notificationClaimed).toBe(true);

    // The same UTC instant is midnight in Kiritimati, so it has a distinct local-day claim.
    const afterLocalMidnight = h.service.snapshot('Pacific/Kiritimati').reminder;
    expect(afterLocalMidnight?.kind).toBe('daily');
    expect(afterLocalMidnight?.id).not.toBe(beforeLocalMidnight!.id);
    const eastClaim = h.service.action('ack', afterLocalMidnight!.id, 'Pacific/Kiritimati');
    expect(eastClaim.notificationClaimed).toBe(true);
    expect(h.service.action('ack', afterLocalMidnight!.id, 'Pacific/Kiritimati').notificationClaimed).toBe(false);
  });

  it('issues a fresh reminder claim for a new continuous block after a qualified manual rest', () => {
    const h = setup();
    h.focus.active = true;
    h.service.configure({ breakAfterMinutes: 20, breakMinutes: 2, dailyLimitMinutes: 720 }, 'UTC');
    h.sample(T0);
    for (let i = 1; i <= (20 * MINUTE) / WELLBEING_SAMPLE_MS; i++) {
      h.sample(T0 + i * WELLBEING_SAMPLE_MS);
    }

    const first = h.service.snapshot('UTC').reminder;
    expect(first?.kind).toBe('break');
    expect(h.service.action('ack', first!.id, 'UTC').notificationClaimed).toBe(true);

    h.service.action('pause', undefined, 'UTC');
    const pauseStart = h.clock.now;
    for (let i = 1; i <= (2 * MINUTE) / WELLBEING_SAMPLE_MS; i++) {
      h.sample(pauseStart + i * WELLBEING_SAMPLE_MS);
    }
    expect(h.service.snapshot('UTC').periods.day.breakCount).toBe(1);
    h.service.action('resume', undefined, 'UTC');

    const resumedAt = h.clock.now;
    h.sample(resumedAt);
    for (let i = 1; i <= (20 * MINUTE) / WELLBEING_SAMPLE_MS; i++) {
      h.sample(resumedAt + i * WELLBEING_SAMPLE_MS);
    }
    const second = h.service.snapshot('UTC').reminder;
    expect(second?.kind).toBe('break');
    expect(second?.id).not.toBe(first!.id);
    expect(h.service.action('ack', second!.id, 'UTC').notificationClaimed).toBe(true);
  });

  it('does not restore an expired browser lease or credit downtime after a server restart', () => {
    const temp = tempDir('wellbeing-restart-');
    temps.push(temp);
    const file = join(temp.dir, 'wellbeing.json');
    const h = setup(T0, file);
    h.sample(T0);
    expect(h.service.pulse(true, CLIENT)).toBe(true);
    h.sample(T0 + WELLBEING_SAMPLE_MS);

    // Stop while the client lease is live, then restart after it expires.
    h.clock.now = T0 + 15 * SECOND;
    h.service.stop();

    const restarted = setup(T0 + WELLBEING_BROWSER_LEASE_MS + 5 * SECOND, file);
    const report = restarted.service.snapshot('UTC');
    expect(report.current.personalActive).toBe(false);
    expect(report.periods.day.personalMs).toBe(15 * SECOND);
    expect(report.periods.day.personalCoverageMs).toBe(15 * SECOND);
  });

  it('starts a new block after an unobserved short restart without losing personal totals', () => {
    const temp = tempDir('wellbeing-short-restart-');
    temps.push(temp);
    const file = join(temp.dir, 'wellbeing.json');
    const h = setup(T0, file);
    h.focus.active = true;
    h.sample(T0);
    for (let i = 1; i <= 16 * MINUTE / WELLBEING_SAMPLE_MS; i++) {
      h.sample(T0 + i * WELLBEING_SAMPLE_MS);
    }
    h.service.stop();

    const restartedAt = T0 + 17 * MINUTE;
    const restarted = setup(restartedAt, file);
    restarted.focus.active = true;
    restarted.sample(restartedAt);
    for (let i = 1; i <= 3 * MINUTE / WELLBEING_SAMPLE_MS; i++) {
      restarted.sample(restartedAt + i * WELLBEING_SAMPLE_MS);
    }

    const report = restarted.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(19 * MINUTE);
    expect(report.current.continuousMs).toBe(3 * MINUTE);
    expect(report.periods.day.longestBlockMs).toBe(16 * MINUTE);
  });

  it('closes the personal interval at the focus-change sample while agent time continues', () => {
    const h = setup();
    h.focus.active = true;
    h.agents.active = true;
    h.sample(T0);

    h.focus.active = false;
    h.sample(T0 + WELLBEING_SAMPLE_MS);
    let report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(WELLBEING_SAMPLE_MS);
    expect(report.periods.day.agentMs).toBe(WELLBEING_SAMPLE_MS);
    expect(report.current.personalActive).toBe(false);
    expect(report.current.agentsActive).toBe(true);

    h.sample(T0 + 2 * WELLBEING_SAMPLE_MS);
    report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(WELLBEING_SAMPLE_MS);
    expect(report.periods.day.agentMs).toBe(2 * WELLBEING_SAMPLE_MS);
    expect(report.current.personalActive).toBe(false);
    expect(report.current.agentsActive).toBe(true);
  });
});
