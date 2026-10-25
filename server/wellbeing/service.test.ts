import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { WellbeingService } from './service';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.UTC(2026, 9, 25, 10);
const TAB_A = '00000000-0000-4000-8000-000000000001';
const TAB_B = '00000000-0000-4000-8000-000000000002';
const temps: Array<{ cleanup: () => void }> = [];
afterEach(() => temps.splice(0).forEach((temp) => temp.cleanup()));

function setup(at = T0, file: string | null = null) {
  const clock = { now: at };
  const focus = { supported: true, active: false, idleMs: 0, sampledAt: at };
  const agents = { active: false };
  const service = new WellbeingService({
    file,
    now: () => clock.now,
    desktop: () => ({ ...focus }),
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

describe('WellbeingService', () => {
  it('keeps personal and agent unions separate and does not double count overlapping sources', () => {
    const h = setup();
    h.focus.active = true;
    h.agents.active = true;
    h.sample(T0);
    expect(h.service.pulse(true, TAB_A)).toBe(true);
    expect(h.service.pulse(true, TAB_B)).toBe(true);
    h.sample(T0 + 5 * SECOND);
    expect(h.service.pulse(false, TAB_B)).toBe(true);
    const report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(5 * SECOND);
    expect(report.periods.day.agentMs).toBe(5 * SECOND);
    expect(report.periods.day.personalCoverageMs).toBe(5 * SECOND);
    expect(report.periods.day.coverageMs).toBe(5 * SECOND);
    expect(report.current.personalActive).toBe(true);
    expect(report.current.agentsActive).toBe(true);
    expect(report.current.personalActive).toBe(true); // Inactive tab B cannot clear active tab A.
    h.focus.active = false;
    h.sample(h.clock.now);
    expect(h.service.pulse(false, TAB_A)).toBe(true);
    expect(h.service.snapshot('UTC').current.personalActive).toBe(false);
  });

  it('bounds browser clients, expires stale leases, and clears browser tracking when disabled', () => {
    const h = setup();
    h.sample(T0);
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    for (let i = 1; i <= 64; i++) expect(h.service.pulse(true, id(i))).toBe(true);
    expect(h.service.pulse(true, id(65))).toBe(false);
    h.clock.now = T0 + 21 * SECOND;
    expect(h.service.snapshot('UTC').current.personalActive).toBe(false);
    h.service.pulse(true, TAB_A);
    expect(h.service.snapshot('UTC').current.personalActive).toBe(true);
    h.service.configure({ trackingEnabled: false }, 'UTC');
    expect(h.service.snapshot('UTC').current.personalActive).toBe(false);
  });

  it('does not treat a stale native focus sample as personal coverage', () => {
    const h = setup();
    h.focus.active = true;
    h.focus.sampledAt = T0 - 16 * SECOND;
    h.service.sample(T0);
    h.clock.now = T0 + 5 * SECOND;
    h.service.sample(h.clock.now);
    const report = h.service.snapshot('UTC');
    expect(report.desktopSupported).toBe(false);
    expect(report.periods.day.personalMs).toBe(0);
    expect(report.periods.day.personalCoverageMs).toBe(0);
  });

  it('counts no idle time, caps missed samples, and resets continuous time after the configured gap', () => {
    const h = setup();
    h.service.configure({ breakMinutes: 5 }, 'UTC');
    h.focus.active = true;
    h.sample(T0);
    for (let i = 1; i <= 4; i++) h.sample(T0 + i * 5 * SECOND);
    h.focus.active = false;
    h.sample(T0 + 20 * SECOND);
    for (let i = 5; i <= 66; i++) h.sample(T0 + i * 5 * SECOND);
    let report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(20 * SECOND);
    expect(report.current.continuousMs).toBe(0);

    const start = T0 + 66 * 5 * SECOND;
    h.focus.active = true;
    h.sample(start + 5 * SECOND);
    h.sample(start + 30 * SECOND); // A missed interval over ten seconds is not backfilled.
    report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(20 * SECOND);
  });

  it('does not backfill long gaps or clock rollback and keeps agent sampling when personal tracking is off', () => {
    const h = setup();
    h.focus.active = true;
    h.agents.active = true;
    h.sample(T0);
    h.sample(T0 + 5 * SECOND);
    h.sample(T0 + 50 * SECOND); // 45 seconds absent: no estimate is added.
    h.sample(T0 + 20 * SECOND); // Clock rollback starts a fresh sample segment.
    h.sample(T0 + 25 * SECOND);
    h.service.configure({ trackingEnabled: false }, 'UTC');
    h.sample(T0 + 30 * SECOND);
    const report = h.service.snapshot('UTC');
    expect(report.periods.day.personalMs).toBe(10 * SECOND);
    expect(report.periods.day.agentMs).toBe(15 * SECOND);
    expect(report.periods.day.coverageMs).toBe(15 * SECOND);
    expect(report.periods.day.personalCoverageMs).toBe(10 * SECOND);
  });

  it('records completed manual pauses and claims a daily reminder only once across restart', () => {
    const temp = tempDir('wellbeing-');
    temps.push(temp);
    const file = join(temp.dir, 'wellbeing.json');
    const h = setup(T0, file);
    h.focus.active = true;
    h.sample(T0);
    h.service.configure({ breakMinutes: 2, breakAfterMinutes: 60, dailyLimitMinutes: 30 }, 'UTC');
    for (let i = 1; i <= 360; i++) h.sample(T0 + i * 5 * SECOND);

    const reminder = h.service.snapshot('UTC').reminder;
    expect(reminder?.kind).toBe('daily');
    const snoozed = h.service.action('snooze', reminder!.id, 'UTC');
    expect(snoozed.reminder).toBeUndefined();
    expect(snoozed.current.snoozedUntil).toBe(h.clock.now + 10 * MINUTE);
    h.clock.now += 10 * MINUTE;
    const postponedReminder = h.service.snapshot('UTC').reminder!;
    expect(postponedReminder.id).not.toBe(reminder!.id);
    expect(h.service.action('ack', postponedReminder.id, 'UTC').notificationClaimed).toBe(true);

    const restarted = setup(h.clock.now + SECOND, file);
    expect(restarted.service.snapshot('UTC').reminder?.id).toBe(postponedReminder.id);
    expect(restarted.service.action('ack', postponedReminder.id, 'UTC').notificationClaimed).toBe(false);
    restarted.service.action('pause', undefined, 'UTC');
    const earlyPauseStart = restarted.clock.now;
    for (let i = 1; i <= 12; i++) restarted.sample(earlyPauseStart + i * 5 * SECOND);
    expect(restarted.service.action('resume', undefined, 'UTC').periods.day.breakCount).toBe(0);
    restarted.service.action('pause', undefined, 'UTC');
    const pauseStart = restarted.clock.now;
    for (let i = 1; i <= 24; i++) restarted.sample(pauseStart + i * 5 * SECOND);
    expect(restarted.service.snapshot('UTC').periods.day.breakCount).toBe(1);
    expect(restarted.service.snapshot('UTC').current.breakUntil).toBe(0); // Deadline auto-resumes tracking.
    restarted.service.action('resume', undefined, 'UTC');
    expect(restarted.service.snapshot('UTC').periods.day.breakCount).toBe(1);

    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      'agents',
      'breakUntil',
      'breaks',
      'claimedReminderIds',
      'continuousMs',
      'continuousStartAt',
      'coverage',
      'coverageStartAt',
      'lastPersonalAt',
      'pauseCompleted',
      'pauseObservedMs',
      'pauseStartedAt',
      'personal',
      'personalCoverage',
      'preferences',
      'snoozedUntil',
      'version',
    ]);
  });

  it('auto-resumes an unobserved timed pause without recording a completed break', () => {
    const h = setup();
    h.sample(T0);
    h.service.configure({ breakMinutes: 2 }, 'UTC');
    h.service.action('pause', undefined, 'UTC');
    h.clock.now += 2 * MINUTE;
    const report = h.service.snapshot('UTC');
    expect(report.current.breakUntil).toBe(0);
    expect(report.periods.day.breakCount).toBe(0);
  });

  it('keeps a 93-day bound and starts with zero coverage after a corrupt file', () => {
    const temp = tempDir('wellbeing-');
    temps.push(temp);
    const file = join(temp.dir, 'wellbeing.json');
    writeFileSync(file, '{not-json');
    const h = setup(T0, file);
    expect(() => h.service.snapshot('UTC')).not.toThrow();
    expect(h.service.snapshot('UTC').periods.day.coverageMs).toBe(0);

    h.focus.active = true;
    h.sample(T0);
    h.sample(T0 + 5 * SECOND);
    h.clock.now = T0 + 94 * DAY;
    const afterRetention = h.service.snapshot('UTC');
    expect(afterRetention.coverageStartAt).toBeGreaterThan(T0);
    expect(afterRetention.periods.day.coverageMs).toBe(0);
    expect(afterRetention.periods.day.personalCoverageMs).toBe(0);
    expect(afterRetention.periods.day.personalMs).toBe(0);
  });

  it('persists preferences and reports zero coverage for an unobserved period', () => {
    const temp = tempDir('wellbeing-');
    temps.push(temp);
    const file = join(temp.dir, 'wellbeing.json');
    const h = setup(T0, file);
    h.service.configure({ remindersEnabled: false, dailyLimitMinutes: 200 }, 'UTC');
    h.service.stop();
    const again = setup(T0, file);
    const report = again.service.snapshot('UTC');
    expect(report.preferences).toMatchObject({ remindersEnabled: false, dailyLimitMinutes: 200 });
    expect(report.periods.month.days.every((day) => day.coverageMs === 0)).toBe(true);
  });
});
