import { expect, it } from 'vitest';
import { WellbeingService } from './service';

it('can notify once again after an explicitly requested snooze, while keeping concurrent claims unique', () => {
  let now = Date.parse('2026-10-25T12:00:00Z');
  const service = new WellbeingService({ file: null, now: () => now, agentsActive: () => false, desktop: () => ({ supported: true, active: true, idleMs: 0, sampledAt: now }) });
  const advance = (count: number) => { for (let i = 0; i < count; i++) { now += 5_000; service.sample(); } };
  service.load(); service.configure({ breakAfterMinutes: 20 }); service.sample();
  advance(241);
  const first = service.snapshot('UTC').reminder!;
  expect(first.kind).toBe('break');
  expect(service.action('ack', first.id, 'UTC').notificationClaimed).toBe(true);
  service.action('snooze', first.id, 'UTC');
  expect(service.snapshot('UTC').reminder).toBeUndefined();
  advance(121);
  const next = service.snapshot('UTC').reminder!;
  expect(next.id).not.toBe(first.id);
  expect(service.action('ack', next.id, 'UTC').notificationClaimed).toBe(true);
  expect(service.action('ack', next.id, 'UTC').notificationClaimed).toBe(false);
  service.stop();
});
