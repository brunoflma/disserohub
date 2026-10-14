export const PRODUCT_NAME = 'Dissero';
export const LOCAL_HOST = 'dissero.localhost';
export const LEGACY_LOCAL_HOST = 'habblaud.localhost';
export const PREFERENCE_TRANSFER_PATH = '/api/branding/preferences';
export const ORIGIN_READY_KEY = 'dissero:origin-ready:v1';
export const PREFERENCE_VALUE_MAX = 1024 * 1024;
export const PREFERENCE_BODY_MAX = 2 * 1024 * 1024;

// Keep the existing identifiers. Only these UI settings can cross between the two local origins.
export const PREFERENCE_KEYS = [
  'habblaud:prefs', 'habblaud:update-seen', 'habblaud.rooms.order', 'habblaud.tabs.order',
  'habblaud.move.drawer', 'habblaud.move.term', 'habblaud.deliveries.seen',
  'habblaud.spawn.folder', 'habblaud.wallets.v1',
] as const;
export type PreferenceEntries = Partial<Record<typeof PREFERENCE_KEYS[number], string>>;
export interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }

export function parsePreferenceEntries(raw: unknown): PreferenceEntries | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.some(([key, value]) => !PREFERENCE_KEYS.includes(key as typeof PREFERENCE_KEYS[number]) || typeof value !== 'string' || value.length > PREFERENCE_VALUE_MAX)) return null;
  return Object.fromEntries(entries) as PreferenceEntries;
}

export function collectPreferences(storage: Pick<PreferenceStorage, 'getItem'> | null): PreferenceEntries {
  const entries: PreferenceEntries = {};
  for (const key of PREFERENCE_KEYS) {
    try { const value = storage?.getItem(key); if (value != null) entries[key] = value; } catch { /* Restricted storage. */ }
  }
  return entries;
}

export function importPreferences(storage: PreferenceStorage | null, entries: PreferenceEntries): boolean {
  let complete = true;
  for (const key of PREFERENCE_KEYS) {
    const value = entries[key];
    if (value === undefined) continue;
    try {
      if (!storage) { complete = false; continue; }
      if (storage.getItem(key) === null) storage.setItem(key, value);
    } catch { complete = false; } // The caller must not initialize replacement defaults.
  }
  return complete;
}
