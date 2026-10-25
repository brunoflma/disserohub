import { addDays, dayKeyOf, dayRange, parseDayKey } from './daystats';

export const WELLBEING_RETENTION_DAYS = 93;
export const WELLBEING_SAMPLE_MS = 5_000;
export const WELLBEING_MAX_INTERVAL_MS = 10_000;
export const WELLBEING_BROWSER_LEASE_MS = 20_000;
export const WELLBEING_FOCUS_FRESH_MS = 15_000;
export const WELLBEING_CONTINUOUS_RESET_MS = 5 * 60_000;
export const WELLBEING_SNOOZE_MS = 10 * 60_000;

export interface WellbeingPreferences {
  trackingEnabled: boolean;
  remindersEnabled: boolean;
  breakAfterMinutes: number;
  breakMinutes: number;
  dailyLimitMinutes: number;
}

export const DEFAULT_WELLBEING_PREFERENCES: Readonly<WellbeingPreferences> = Object.freeze({
  trackingEnabled: true,
  remindersEnabled: true,
  breakAfterMinutes: 50,
  breakMinutes: 5,
  dailyLimitMinutes: 240,
});

export type WellbeingPeriodName = 'day' | 'week' | 'month';

export interface WellbeingDayMetrics {
  day: string;
  personalMs: number;
  agentMs: number;
  /** Time for which personal activity signals were freshly observable. */
  personalCoverageMs: number;
  /** Time for which the server's agent activity sampler was freshly observable. */
  coverageMs: number;
}

export interface WellbeingPeriod {
  start: number;
  end: number;
  personalMs: number;
  agentMs: number;
  personalCoverageMs: number;
  coverageMs: number;
  longestBlockMs: number;
  breakCount: number;
  days: WellbeingDayMetrics[];
}

export interface WellbeingCurrent {
  personalActive: boolean;
  agentsActive: boolean;
  continuousMs: number;
  breakUntil: number;
  snoozedUntil: number;
}

export type WellbeingReminderKind = 'break' | 'daily';

export interface WellbeingReminder {
  id: string;
  kind: WellbeingReminderKind;
}

export interface WellbeingReport {
  persistence?: 'ok' | 'error' | 'memory';
  now: number;
  coverageStartAt: number;
  desktopSupported: boolean;
  preferences: WellbeingPreferences;
  periods: Record<WellbeingPeriodName, WellbeingPeriod>;
  current: WellbeingCurrent;
  reminder?: WellbeingReminder;
  /** Present only for POST /action ack; true means this caller claimed the notification. */
  notificationClaimed?: boolean;
}

export interface FocusSample {
  supported: boolean;
  active: boolean;
  idleMs?: number;
  sampledAt?: number;
}

const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWellbeingClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ID_RE.test(value);
}

export type WellbeingAction = 'pause' | 'resume' | 'snooze' | 'ack';

export interface WellbeingPeriodRange {
  start: number;
  end: number;
  days: string[];
}

const clampRound = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

export function sanitizeWellbeingPreferences(
  input: unknown,
  base: WellbeingPreferences = { ...DEFAULT_WELLBEING_PREFERENCES },
): WellbeingPreferences {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    trackingEnabled: typeof value.trackingEnabled === 'boolean' ? value.trackingEnabled : base.trackingEnabled,
    remindersEnabled: typeof value.remindersEnabled === 'boolean' ? value.remindersEnabled : base.remindersEnabled,
    breakAfterMinutes: clampRound(value.breakAfterMinutes, base.breakAfterMinutes, 20, 180),
    breakMinutes: clampRound(value.breakMinutes, base.breakMinutes, 2, 30),
    dailyLimitMinutes: clampRound(value.dailyLimitMinutes, base.dailyLimitMinutes, 30, 720),
  };
}

function dayKeys(first: string, end: number, tz: string): string[] {
  const out: string[] = [];
  for (let key = first; ; key = addDays(key, 1)) {
    const range = dayRange(key, tz);
    if (range.start >= end) break;
    out.push(key);
  }
  return out;
}

function monthStartKey(day: string): string {
  const parsed = parseDayKey(day)!;
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-01`;
}

function nextMonthStartKey(day: string): string {
  const parsed = parseDayKey(day)!;
  const date = new Date(Date.UTC(parsed.y, parsed.m, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Calendar-period bounds in the requested IANA zone; day boundaries remain DST-safe. */
export function wellbeingPeriodRange(name: WellbeingPeriodName, now: number, tz: string): WellbeingPeriodRange {
  const today = dayKeyOf(now, tz);
  let first: string;
  let afterLast: string;
  if (name === 'day') {
    first = today;
    afterLast = addDays(today, 1);
  } else if (name === 'week') {
    const parts = parseDayKey(today)!;
    const weekday = new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
    first = addDays(today, -((weekday + 6) % 7));
    afterLast = addDays(first, 7);
  } else {
    first = monthStartKey(today);
    afterLast = nextMonthStartKey(today);
  }
  const start = dayRange(first, tz).start;
  const end = dayRange(afterLast, tz).start;
  return { start, end, days: dayKeys(first, end, tz) };
}
