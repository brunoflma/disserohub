import { describe, expect, it } from 'vitest';
import { activityRecent, chartWidth, wellbeingDuration } from './wellbeing-model';

describe('personal activity admission', () => {
  it('requires focus, visibility and a recent interaction, and rejects backwards clocks', () => {
    expect(activityRecent(10_000, 20_000, true, true, true)).toBe(true);
    expect(activityRecent(10_000, 20_000, false, true, true)).toBe(false);
    expect(activityRecent(10_000, 20_000, true, false, true)).toBe(false);
    expect(activityRecent(10_000, 20_000, true, true, false)).toBe(false);
    expect(activityRecent(10_000, 130_000, true, true, true)).toBe(false);
    expect(activityRecent(10_000, 9_999, true, true, true)).toBe(false);
  });
});
describe('wellbeing display', () => {
  it('distinguishes a fresh observation from a full minute and formats hours without agent multiplication', () => {
    expect(wellbeingDuration(0)).toBe('0 min');
    expect(wellbeingDuration(25_000)).toBe('menos de 1 min');
    expect(wellbeingDuration(62 * 60_000)).toBe('1 h 2 min');
    expect(wellbeingDuration(Number.NaN)).toBe('0 min');
    expect(wellbeingDuration(-1000)).toBe('0 min');
  });
  it('bounds chart bars without treating unobserved days as measurements', () => {
    expect(chartWidth(15, 30)).toBe('50%');
    expect(chartWidth(50, 30)).toBe('100%');
    expect(chartWidth(0, 0)).toBe('0%');
  });
});
