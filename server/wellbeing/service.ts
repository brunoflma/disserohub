import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  canonicalTimeZone,
  dayRange,
  systemTimeZone,
} from '../../shared/daystats';
import {
  DEFAULT_WELLBEING_PREFERENCES,
  WELLBEING_BROWSER_LEASE_MS,
  WELLBEING_FOCUS_FRESH_MS,
  WELLBEING_MAX_INTERVAL_MS,
  WELLBEING_RETENTION_DAYS,
  WELLBEING_SAMPLE_MS,
  WELLBEING_SNOOZE_MS,
  sanitizeWellbeingPreferences,
  wellbeingPeriodRange,
  type FocusSample,
  type WellbeingAction,
  type WellbeingDayMetrics,
  type WellbeingPeriod,
  type WellbeingPeriodName,
  type WellbeingPreferences,
  type WellbeingReport,
  isWellbeingClientId,
} from '../../shared/wellbeing';

const VERSION = 1;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_INTERVALS = 100_000;
const MAX_BROWSER_CLIENTS = 64;
const MAX_BREAKS = 10_000;
const MAX_CLAIMS = 2_000;
const DAY_MS = 86_400_000;
const MS_PER_MINUTE = 60_000;

type Interval = [number, number];
interface BrowserLease {
  activeUntil: number;
  observedUntil: number;
}

interface StoredWellbeing {
  version: 1;
  coverageStartAt: number;
  preferences: WellbeingPreferences;
  personal: Interval[];
  agents: Interval[];
  coverage: Interval[];
  personalCoverage: Interval[];
  breaks: number[];
  claimedReminderIds: string[];
  pauseStartedAt: number | null;
  pauseObservedMs: number;
  pauseCompleted: boolean;
  breakUntil: number;
  snoozedUntil: number;
  continuousMs: number;
  continuousStartAt: number | null;
  lastPersonalAt: number | null;
}

export interface WellbeingServiceOptions {
  /** One state file; null keeps the bounded history in memory only. */
  file: string | null;
  agentsActive: () => boolean;
  desktop: () => FocusSample;
  now?: () => number;
  onPreferences?: (preferences: WellbeingPreferences) => void;
}

function finiteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseIntervals(value: unknown, cutoff: number): Interval[] {
  if (!Array.isArray(value)) return [];
  const intervals: Interval[] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2 || !finiteTime(row[0]) || !finiteTime(row[1]) || row[1] <= row[0]) continue;
    if (row[1] <= cutoff) continue;
    insertMerged(intervals, Math.max(row[0], cutoff), row[1]);
  }
  return intervals;
}

function parseTimes(value: unknown, cutoff: number, max: number): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((n): n is number => finiteTime(n) && n >= cutoff)
    .sort((a, b) => a - b)
    .slice(-max);
}

/** Insert a chronological interval, merging touching/overlapping ranges. Rollback inserts stay ordered too. */
function insertMerged(intervals: Interval[], start: number, end: number): void {
  if (!(end > start)) return;
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (intervals[mid]![0] <= start) lo = mid + 1;
    else hi = mid;
  }
  let at = lo;
  let mergedStart = start;
  let mergedEnd = end;
  if (at > 0 && intervals[at - 1]![1] >= start) {
    at--;
    mergedStart = Math.min(mergedStart, intervals[at]![0]);
    mergedEnd = Math.max(mergedEnd, intervals[at]![1]);
  }
  let after = at;
  while (after < intervals.length && intervals[after]![0] <= mergedEnd) {
    mergedStart = Math.min(mergedStart, intervals[after]![0]);
    mergedEnd = Math.max(mergedEnd, intervals[after]![1]);
    after++;
  }
  intervals.splice(at, after - at, [mergedStart, mergedEnd]);
}

function mergedRanges(ranges: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [start, end] of ranges) insertMerged(out, start, end);
  return out;
}

function intersectRanges(left: Interval[], right: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i]!;
    const b = right[j]!;
    const start = Math.max(a[0], b[0]);
    const end = Math.min(a[1], b[1]);
    if (end > start) out.push([start, end]);
    if (a[1] <= b[1]) i++;
    else j++;
  }
  return out;
}

function measure(intervals: Interval[], start: number, end: number): number {
  let total = 0;
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (intervals[mid]![1] <= start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < intervals.length; i++) {
    const [a, b] = intervals[i]!;
    if (a >= end) break;
    total += Math.max(0, Math.min(b, end) - Math.max(a, start));
  }
  return Math.round(total);
}

function coveredGap(coverage: Interval[], start: number, end: number): boolean {
  if (end <= start) return true;
  for (const [a, b] of coverage) {
    if (a > start) return false;
    if (a <= start && b >= end) return true;
  }
  return false;
}

function longestBlock(personal: Interval[], coverage: Interval[], start: number, end: number, resetGap: number): number {
  let current = 0;
  let best = 0;
  let previousEnd = -Infinity;
  let lo = 0;
  let hi = personal.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (personal[mid]![1] <= start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < personal.length; i++) {
    const [a, b] = personal[i]!;
    if (a >= end) break;
    const clippedStart = Math.max(a, start);
    const clippedEnd = Math.min(b, end);
    if (clippedEnd <= clippedStart) continue;
    if (clippedStart - previousEnd >= resetGap || !coveredGap(coverage, previousEnd, clippedStart)) current = 0;
    current += clippedEnd - clippedStart;
    best = Math.max(best, current);
    previousEnd = clippedEnd;
  }
  return Math.round(best);
}

function safeFocus(source: () => FocusSample, now: number): FocusSample {
  try {
    const value = source();
    if (!value || typeof value.supported !== 'boolean' || typeof value.active !== 'boolean') return { supported: false, active: false };
    if (value.sampledAt === undefined || !finiteTime(value.sampledAt) || value.sampledAt > now || now - value.sampledAt > WELLBEING_FOCUS_FRESH_MS) {
      return { supported: false, active: false };
    }
    if (value.idleMs !== undefined && (!Number.isFinite(value.idleMs) || value.idleMs < 0)) return { supported: false, active: false };
    return value;
  } catch {
    return { supported: false, active: false };
  }
}

function readAgentSample(source: () => boolean): { active: boolean; observed: boolean } {
  try {
    const value = source();
    return typeof value === 'boolean' ? { active: value, observed: true } : { active: false, observed: false };
  } catch {
    return { active: false, observed: false };
  }
}

function isDesktopActive(focus: FocusSample): boolean {
  return focus.supported && focus.active && (focus.idleMs === undefined || focus.idleMs < 5 * MS_PER_MINUTE);
}

function sanitizeStored(raw: unknown, now: number): StoredWellbeing | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (data.version !== VERSION || !finiteTime(data.coverageStartAt)) return null;
  const cutoff = now - WELLBEING_RETENTION_DAYS * DAY_MS;
  const pauseStartedAt = data.pauseStartedAt === null ? null : finiteTime(data.pauseStartedAt) ? data.pauseStartedAt : null;
  const continuousStartAt = data.continuousStartAt === null ? null : finiteTime(data.continuousStartAt) ? data.continuousStartAt : null;
  const lastPersonalAt = data.lastPersonalAt === null ? null : finiteTime(data.lastPersonalAt) ? data.lastPersonalAt : null;
  const ids = Array.isArray(data.claimedReminderIds)
    ? data.claimedReminderIds.filter((id): id is string => typeof id === 'string' && id.length <= 96).slice(-MAX_CLAIMS)
    : [];
  return {
    version: VERSION,
    coverageStartAt: Math.min(data.coverageStartAt, now),
    preferences: sanitizeWellbeingPreferences(data.preferences),
    personal: parseIntervals(data.personal, cutoff),
    agents: parseIntervals(data.agents, cutoff),
    coverage: parseIntervals(data.coverage, cutoff),
    personalCoverage: parseIntervals(data.personalCoverage, cutoff),
    breaks: parseTimes(data.breaks, cutoff, MAX_BREAKS),
    claimedReminderIds: [...new Set(ids)],
    pauseStartedAt: pauseStartedAt !== null && pauseStartedAt >= cutoff ? pauseStartedAt : null,
    pauseObservedMs: typeof data.pauseObservedMs === 'number' && Number.isFinite(data.pauseObservedMs) ? Math.max(0, Math.min(data.pauseObservedMs, 30 * MS_PER_MINUTE)) : 0,
    pauseCompleted: data.pauseCompleted === true,
    breakUntil: finiteTime(data.breakUntil) ? data.breakUntil : 0,
    // Keep an expired snooze as the notification generation across restarts.
    snoozedUntil: finiteTime(data.snoozedUntil) && data.snoozedUntil <= now + WELLBEING_SNOOZE_MS ? data.snoozedUntil : 0,
    continuousMs: typeof data.continuousMs === 'number' && Number.isFinite(data.continuousMs) ? Math.max(0, Math.min(data.continuousMs, WELLBEING_RETENTION_DAYS * DAY_MS)) : 0,
    continuousStartAt: continuousStartAt !== null && continuousStartAt <= now ? continuousStartAt : null,
    lastPersonalAt: lastPersonalAt !== null && lastPersonalAt <= now ? lastPersonalAt : null,
  };
}

export class WellbeingService {
  private persistenceError = false;
  private readonly now: () => number;
  private readonly personal: Interval[] = [];
  private readonly agents: Interval[] = [];
  private readonly coverage: Interval[] = [];
  private readonly personalCoverage: Interval[] = [];
  private breaks: number[] = [];
  private claimedReminderIds = new Set<string>();
  private preferences: WellbeingPreferences = { ...DEFAULT_WELLBEING_PREFERENCES };
  private coverageStartAt: number;
  private lastAt: number | null = null;
  private lastDesktopSupported = false;
  private lastDesktopActive = false;
  private lastAgentsActive = false;
  private lastAgentsObserved = false;
  private readonly browserLeases = new Map<string, BrowserLease>();
  private pauseStartedAt: number | null = null;
  private pauseObservedMs = 0;
  private pauseCompleted = false;
  private breakUntil = 0;
  private snoozedUntil = 0;
  private continuousMs = 0;
  private continuousStartAt: number | null = null;
  private lastPersonalAt: number | null = null;
  private loaded = false;
  private dirty = false;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: WellbeingServiceOptions) {
    this.now = options.now ?? Date.now;
    this.coverageStartAt = this.now();
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const now = this.now();
    this.coverageStartAt = now;
    if (this.options.file) {
      try {
        const size = statSync(this.options.file).size;
        if (size > 0 && size <= MAX_FILE_BYTES) {
          const parsed = sanitizeStored(JSON.parse(readFileSync(this.options.file, 'utf8')), now);
          if (parsed) {
            this.coverageStartAt = parsed.coverageStartAt;
            this.preferences = parsed.preferences;
            this.personal.push(...parsed.personal);
            this.agents.push(...parsed.agents);
            this.coverage.push(...parsed.coverage);
            this.personalCoverage.push(...parsed.personalCoverage);
            this.breaks = parsed.breaks;
            this.claimedReminderIds = new Set(parsed.claimedReminderIds);
            this.pauseStartedAt = parsed.pauseStartedAt;
            this.pauseObservedMs = parsed.pauseObservedMs;
            this.pauseCompleted = parsed.pauseCompleted;
            this.breakUntil = parsed.breakUntil;
            this.snoozedUntil = parsed.snoozedUntil;
            this.continuousMs = parsed.continuousMs;
            this.continuousStartAt = parsed.continuousStartAt;
            this.lastPersonalAt = parsed.lastPersonalAt;
            this.dirty = true;
          }
        }
      } catch {
        // A missing or corrupt file is a fresh, usable history; no session material is inspected.
      }
    }
    this.expireContinuous(now);
    this.completePauseIfDue(now);
    this.trim(now);
    this.callPreferences();
  }

  start(): void {
    this.load();
    if (this.sampleTimer) return;
    this.sample(this.now());
    this.sampleTimer = setInterval(() => this.safely(() => this.sample(this.now())), WELLBEING_SAMPLE_MS);
    this.flushTimer = setInterval(() => this.safely(() => this.flush()), 30_000);
    this.sampleTimer.unref?.();
    this.flushTimer.unref?.();
  }

  stop(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.sampleTimer = null;
    this.flushTimer = null;
    if (this.loaded) this.sample(this.now());
    this.flush();
  }

  /** One bounded sample; exposed so callers and deterministic tests can advance an injected clock. */
  sample(now = this.now()): void {
    this.ensureLoaded();
    if (!finiteTime(now)) return;
    this.advance(now);
    const focus = safeFocus(this.options.desktop, now);
    this.lastDesktopSupported = focus.supported;
    this.lastDesktopActive = isDesktopActive(focus);
    const agents = readAgentSample(this.options.agentsActive);
    this.lastAgentsActive = agents.active;
    this.lastAgentsObserved = agents.observed;
    if (this.lastAt === null) this.lastAt = now;
    this.dirty = true;
  }

  pulse(active: boolean, clientId: string): boolean {
    this.ensureLoaded();
    if (!isWellbeingClientId(clientId)) return false;
    const now = this.now();
    if (!finiteTime(now)) return false;
    this.advance(now);
    this.pruneBrowserLeases(now);
    if (!this.preferences.trackingEnabled || this.pauseStartedAt !== null) {
      this.browserLeases.delete(clientId);
      return true;
    }
    if (!this.browserLeases.has(clientId) && this.browserLeases.size >= MAX_BROWSER_CLIENTS) return false;
    this.browserLeases.set(clientId, {
      activeUntil: active ? now + WELLBEING_BROWSER_LEASE_MS : now,
      observedUntil: now + WELLBEING_BROWSER_LEASE_MS,
    });
    this.dirty = true;
    return true;
  }

  configure(patch: Partial<WellbeingPreferences>, tz = systemTimeZone()): WellbeingReport {
    this.ensureLoaded();
    const now = this.now();
    this.advance(now);
    const next = sanitizeWellbeingPreferences(patch, this.preferences);
    if (next.trackingEnabled !== this.preferences.trackingEnabled && !next.trackingEnabled) {
      this.resetContinuous();
      this.browserLeases.clear();
      this.lastDesktopSupported = false;
      this.lastDesktopActive = false;
    } else if (next.trackingEnabled !== this.preferences.trackingEnabled) {
      this.browserLeases.clear();
      this.lastDesktopSupported = false;
      this.lastDesktopActive = false;
    }
    this.preferences = next;
    this.callPreferences();
    this.dirty = true;
    this.flush();
    return this.buildReport(now, tz);
  }

  action(action: WellbeingAction, id?: string, tz = systemTimeZone()): WellbeingReport {
    this.ensureLoaded();
    const now = this.now();
    this.advance(now);
    const reminder = this.currentReminder(now, tz);
    let notificationClaimed: boolean | undefined;
    if (action === 'pause') {
      if (this.pauseStartedAt === null) {
        this.pauseStartedAt = now;
        this.pauseObservedMs = 0;
        this.pauseCompleted = false;
        this.breakUntil = now + this.preferences.breakMinutes * MS_PER_MINUTE;
        this.browserLeases.clear();
        this.lastDesktopSupported = false;
        this.lastDesktopActive = false;
        this.resetContinuous();
      }
    } else if (action === 'resume') {
      this.completePauseIfDue(now);
      this.pauseStartedAt = null;
      this.pauseObservedMs = 0;
      this.pauseCompleted = false;
      this.breakUntil = 0;
      this.lastDesktopSupported = false;
      this.lastDesktopActive = false;
    } else if (action === 'snooze') {
      if (id === undefined || (reminder && id === reminder.id)) this.snoozedUntil = now + WELLBEING_SNOOZE_MS;
    } else if (action === 'ack') {
      notificationClaimed = false;
      if (reminder && id === reminder.id && !this.claimedReminderIds.has(id)) {
        this.claimedReminderIds.add(id);
        if (this.claimedReminderIds.size > MAX_CLAIMS) {
          const oldest = this.claimedReminderIds.values().next().value as string | undefined;
          if (oldest) this.claimedReminderIds.delete(oldest);
        }
        notificationClaimed = true;
      }
    }
    this.dirty = true;
    this.flush();
    const report = this.buildReport(now, tz);
    if (action === 'ack') report.notificationClaimed = notificationClaimed === true;
    return report;
  }

  snapshot(tz = systemTimeZone()): WellbeingReport {
    this.ensureLoaded();
    const now = this.now();
    this.advance(now);
    return this.buildReport(now, tz);
  }

  flush(): void {
    this.ensureLoaded();
    const now = this.now();
    this.trim(now);
    if (!this.dirty || !this.options.file) return;
    const data: StoredWellbeing = {
      version: VERSION,
      coverageStartAt: this.coverageStartAt,
      preferences: { ...this.preferences },
      personal: this.personal,
      agents: this.agents,
      coverage: this.coverage,
      personalCoverage: this.personalCoverage,
      breaks: this.breaks,
      claimedReminderIds: [...this.claimedReminderIds].slice(-MAX_CLAIMS),
      pauseStartedAt: this.pauseStartedAt,
      pauseObservedMs: this.pauseObservedMs,
      pauseCompleted: this.pauseCompleted,
      breakUntil: this.breakUntil,
      snoozedUntil: this.snoozedUntil,
      continuousMs: this.continuousMs,
      continuousStartAt: this.continuousStartAt,
      lastPersonalAt: this.lastPersonalAt,
    };
    try {
      mkdirSync(dirname(this.options.file), { recursive: true });
      const tmp = `${this.options.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.options.file);
      this.persistenceError = false;
      this.dirty = false;
    } catch {
      this.persistenceError = true;
      // A disk failure never stops live sampling; the next flush can retry.
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private advance(now: number): void {
    if (this.lastAt === null) {
      this.lastAt = now;
      this.expireContinuous(now);
      return;
    }
    if (now < this.lastAt) {
      // Wall-clock rollback is a discontinuity: discard leases and do not backfill across it.
      this.lastAt = now;
      this.browserLeases.clear();
      this.lastDesktopSupported = false;
      this.lastDesktopActive = false;
      this.lastAgentsActive = false;
      this.lastAgentsObserved = false;
      this.resetContinuous();
      this.dirty = true;
      return;
    }
    const from = this.lastAt;
    const dt = now - from;
    if (dt > 0 && dt <= WELLBEING_MAX_INTERVAL_MS && this.pauseStartedAt !== null) {
      const pauseStart = Math.max(from, this.pauseStartedAt);
      const pauseEnd = Math.min(now, this.breakUntil);
      if (pauseEnd > pauseStart) this.pauseObservedMs += pauseEnd - pauseStart;
    }
    if (dt > 0 && dt <= WELLBEING_MAX_INTERVAL_MS) {
      if (this.lastAgentsObserved) insertMerged(this.coverage, from, now);
      if (this.lastAgentsObserved && this.lastAgentsActive) insertMerged(this.agents, from, now);

      if (this.preferences.trackingEnabled && this.pauseStartedAt === null) {
        const personalCoverageRanges: Interval[] = [];
        const activeRanges: Interval[] = [];
        if (this.lastDesktopSupported) {
          personalCoverageRanges.push([from, now]);
          if (this.lastDesktopActive) activeRanges.push([from, now]);
        }
        for (const lease of this.browserLeases.values()) {
          if (lease.observedUntil > from) personalCoverageRanges.push([from, Math.min(now, lease.observedUntil)]);
          if (lease.activeUntil > from) activeRanges.push([from, Math.min(now, lease.activeUntil)]);
        }
        const observed = mergedRanges(personalCoverageRanges);
        const personal = intersectRanges(mergedRanges(activeRanges), observed);
        for (const [start, end] of observed) insertMerged(this.personalCoverage, start, end);
        for (const [start, end] of personal) {
          insertMerged(this.personal, start, end);
          this.addContinuous(start, end);
        }
      }
      this.dirty = true;
    }
    this.lastAt = now;
    this.expireContinuous(now);
    this.completePauseIfDue(now);
    this.pruneBrowserLeases(now);
    this.trim(now);
  }

  private addContinuous(start: number, end: number): void {
    if (end <= start) return;
    const resetGap = this.preferences.breakMinutes * MS_PER_MINUTE;
    if (this.lastPersonalAt === null || start - this.lastPersonalAt >= resetGap || !coveredGap(this.personalCoverage, this.lastPersonalAt, start)) {
      this.continuousMs = 0;
      this.continuousStartAt = start;
    }
    this.continuousMs += end - start;
    this.lastPersonalAt = end;
  }

  private expireContinuous(now: number): void {
    const resetGap = this.preferences.breakMinutes * MS_PER_MINUTE;
    if (this.lastPersonalAt !== null && (now < this.lastPersonalAt || now - this.lastPersonalAt >= resetGap)) this.resetContinuous();
  }

  private resetContinuous(): void {
    this.continuousMs = 0;
    this.continuousStartAt = null;
    this.lastPersonalAt = null;
  }

  private completePauseIfDue(now: number): void {
    if (this.pauseStartedAt === null || this.pauseCompleted || this.breakUntil <= 0 || now < this.breakUntil) return;
    const completed = this.pauseObservedMs >= this.breakUntil - this.pauseStartedAt;
    if (completed) {
      this.breaks.push(this.breakUntil);
      if (this.breaks.length > MAX_BREAKS) this.breaks.splice(0, this.breaks.length - MAX_BREAKS);
    }
    // Timed pauses end automatically. Missing server samples do not count as a completed break.
    this.pauseStartedAt = null;
    this.pauseObservedMs = 0;
    this.pauseCompleted = false;
    this.breakUntil = 0;
    this.browserLeases.clear();
    this.lastDesktopSupported = false;
    this.lastDesktopActive = false;
    this.resetContinuous();
    this.dirty = true;
  }

  private trim(now: number): void {
    const cutoff = now - WELLBEING_RETENTION_DAYS * DAY_MS;
    for (const list of [this.personal, this.agents, this.coverage, this.personalCoverage]) {
      while (list.length && list[0]![1] <= cutoff) list.shift();
      if (list.length && list[0]![0] < cutoff) list[0]![0] = cutoff;
    }
    this.breaks = this.breaks.filter((at) => at >= cutoff);
    this.coverageStartAt = Math.max(this.coverageStartAt, cutoff);

    let count = this.personal.length + this.agents.length + this.coverage.length + this.personalCoverage.length;
    if (count > MAX_INTERVALS) {
      const lists = [this.personal, this.agents, this.coverage, this.personalCoverage];
      const starts = lists.flatMap((list) => list.map(([start]) => start)).sort((a, b) => a - b);
      let index = Math.min(starts.length - 1, count - MAX_INTERVALS);
      let floor = starts[index];
      while (floor !== undefined) {
        for (const list of lists) {
          while (list.length && list[0]![1] <= floor) list.shift();
          if (list.length && list[0]![0] < floor) list[0]![0] = floor;
        }
        this.coverageStartAt = Math.max(this.coverageStartAt, floor);
        count = this.personal.length + this.agents.length + this.coverage.length + this.personalCoverage.length;
        if (count <= MAX_INTERVALS || index + 1 >= starts.length) break;
        floor = starts[++index];
      }
    }
  }

  private currentReminder(now: number, tz: string): WellbeingReport['reminder'] {
    if (!this.preferences.trackingEnabled || !this.preferences.remindersEnabled || this.pauseStartedAt !== null || now < this.snoozedUntil) return undefined;
    const safeTz = canonicalTimeZone(tz) ?? systemTimeZone();
    if (this.continuousMs >= this.preferences.breakAfterMinutes * MS_PER_MINUTE && this.continuousStartAt !== null) {
      return { id: `break:${Math.floor(this.continuousStartAt)}:${Math.floor(this.snoozedUntil)}`, kind: 'break' };
    }
    const day = wellbeingPeriodRange('day', now, safeTz);
    if (measure(this.personal, day.start, day.end) >= this.preferences.dailyLimitMinutes * MS_PER_MINUTE) {
      return { id: `daily:${Math.floor(day.start)}:${Math.floor(this.snoozedUntil)}`, kind: 'daily' };
    }
    return undefined;
  }

  private buildReport(now: number, tz: string): WellbeingReport {
    const safeTz = canonicalTimeZone(tz) ?? systemTimeZone();
    this.expireContinuous(now);
    const periods = {} as Record<WellbeingPeriodName, WellbeingPeriod>;
    for (const name of ['day', 'week', 'month'] as const) periods[name] = this.period(name, now, safeTz);
    const desktop = safeFocus(this.options.desktop, now);
    const desktopActive = isDesktopActive(desktop);
    const browserActive = [...this.browserLeases.values()].some((lease) => lease.activeUntil > now);
    const personalActive = this.preferences.trackingEnabled && this.pauseStartedAt === null && (desktopActive || browserActive);
    const report: WellbeingReport = {
      persistence: this.options.file ? (this.persistenceError ? 'error' : 'ok') : 'memory',
      now,
      coverageStartAt: this.coverageStartAt,
      desktopSupported: desktop.supported,
      preferences: { ...this.preferences },
      periods,
      current: {
        personalActive,
        agentsActive: readAgentSample(this.options.agentsActive).active,
        continuousMs: this.continuousMs,
        breakUntil: this.breakUntil,
        snoozedUntil: this.snoozedUntil,
      },
    };
    const reminder = this.currentReminder(now, safeTz);
    if (reminder) report.reminder = reminder;
    return report;
  }

  private period(name: WellbeingPeriodName, now: number, tz: string): WellbeingPeriod {
    const range = wellbeingPeriodRange(name, now, tz);
    const resetGap = this.preferences.breakMinutes * MS_PER_MINUTE;
    const days: WellbeingDayMetrics[] = range.days.map((day) => {
      const bounds = dayRange(day, tz);
      return {
        day,
        personalMs: measure(this.personal, bounds.start, bounds.end),
        agentMs: measure(this.agents, bounds.start, bounds.end),
        personalCoverageMs: measure(this.personalCoverage, bounds.start, bounds.end),
        coverageMs: measure(this.coverage, bounds.start, bounds.end),
      };
    });
    return {
      start: range.start,
      end: range.end,
      personalMs: days.reduce((sum, day) => sum + day.personalMs, 0),
      agentMs: days.reduce((sum, day) => sum + day.agentMs, 0),
      personalCoverageMs: days.reduce((sum, day) => sum + day.personalCoverageMs, 0),
      coverageMs: days.reduce((sum, day) => sum + day.coverageMs, 0),
      longestBlockMs: longestBlock(this.personal, this.personalCoverage, range.start, range.end, resetGap),
      breakCount: this.breaks.filter((at) => at >= range.start && at < range.end).length,
      days,
    };
  }

  private callPreferences(): void {
    try {
      this.options.onPreferences?.({ ...this.preferences });
    } catch {
      // Preference persistence is best-effort and must not stop sampling.
    }
  }

  private pruneBrowserLeases(now: number): void {
    for (const [id, lease] of this.browserLeases) if (lease.observedUntil <= now) this.browserLeases.delete(id);
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // Timers are isolated from route and provider failures.
    }
  }
}
