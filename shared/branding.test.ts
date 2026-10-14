import { describe, expect, it } from 'vitest';
import { collectPreferences, importPreferences, parsePreferenceEntries, PREFERENCE_VALUE_MAX } from './branding';

describe('Dissero local preferences', () => {
  it('transfers only known UI settings, never arbitrary keys', () => {
    expect(parsePreferenceEntries({ 'habblaud:prefs': '{"theme":"none"}' })).toEqual({ 'habblaud:prefs': '{"theme":"none"}' });
    expect(parsePreferenceEntries({ credentials: 'private' })).toBeNull();
    expect(parsePreferenceEntries({ 'habblaud:prefs': 4 })).toBeNull();
    const large = { 'habblaud.wallets.v1': 'x'.repeat(75000) };
    expect(parsePreferenceEntries(large)).toEqual(large);
    expect(parsePreferenceEntries({ 'habblaud:prefs': 'x'.repeat(PREFERENCE_VALUE_MAX + 1) })).toBeNull();
    expect(parsePreferenceEntries([])).toBeNull();
  });
  it('copies settings without overwriting the destination or erasing the source', () => {
    const old = new Map([['habblaud:prefs', '{"theme":"none"}'], ['habblaud.rooms.order', '["case-a"]'], ['unrelated', 'private']]);
    const current = new Map([['habblaud:prefs', '{"theme":"christmas"}']]);
    const entries = collectPreferences({ getItem: (key) => old.get(key) ?? null });
    importPreferences({ getItem: (key) => current.get(key) ?? null, setItem: (key, value) => { current.set(key, value); } }, entries);
    expect(current.get('habblaud:prefs')).toBe('{"theme":"christmas"}');
    expect(current.get('habblaud.rooms.order')).toBe('["case-a"]');
    expect(current.has('unrelated')).toBe(false);
    expect(old.get('habblaud.rooms.order')).toBe('["case-a"]');
  });
  it('tolerates unavailable or quota-limited storage', () => {
    expect(collectPreferences(null)).toEqual({});
    expect(importPreferences({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, { 'habblaud:prefs': '{}' })).toBe(false);
  });
});
