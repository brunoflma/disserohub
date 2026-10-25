import { describe, expect, it } from 'vitest';
import { DEFAULT_WELLBEING_PREFERENCES, sanitizeWellbeingPreferences, wellbeingPeriodRange } from './wellbeing';

describe('wellbeing contract', () => {
  it('provides the approved defaults and clamps preference bounds', () => {
    expect(sanitizeWellbeingPreferences({})).toEqual(DEFAULT_WELLBEING_PREFERENCES);
    expect(
      sanitizeWellbeingPreferences({ trackingEnabled: false, breakAfterMinutes: 3, breakMinutes: 90, dailyLimitMinutes: 900 }),
    ).toMatchObject({ trackingEnabled: false, remindersEnabled: true, breakAfterMinutes: 20, breakMinutes: 30, dailyLimitMinutes: 720 });
    expect(sanitizeWellbeingPreferences({ breakAfterMinutes: 51.6, breakMinutes: Number.NaN, dailyLimitMinutes: 31.2 })).toMatchObject({
      breakAfterMinutes: 52,
      breakMinutes: 5,
      dailyLimitMinutes: 31,
    });
  });

  it('uses Monday weeks and complete calendar months', () => {
    const sunday = Date.UTC(2026, 9, 25, 16);
    const week = wellbeingPeriodRange('week', sunday, 'America/Sao_Paulo');
    expect(week.days[0]).toBe('2026-10-19');
    expect(week.days.at(-1)).toBe('2026-10-25');
    expect(week.days).toHaveLength(7);

    const month = wellbeingPeriodRange('month', sunday, 'UTC');
    expect(month.days[0]).toBe('2026-10-01');
    expect(month.days.at(-1)).toBe('2026-10-31');
    expect(month.days).toHaveLength(31);
  });

  it('uses DST-safe local day boundaries', () => {
    const now = Date.UTC(2026, 2, 8, 16);
    const day = wellbeingPeriodRange('day', now, 'America/New_York');
    expect(day.days).toEqual(['2026-03-08']);
    expect(day.end - day.start).toBe(23 * 60 * 60_000);
  });
});
