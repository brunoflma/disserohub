import { collectPreferences, importPreferences, LEGACY_LOCAL_HOST, LOCAL_HOST, ORIGIN_READY_KEY, parsePreferenceEntries, PREFERENCE_TRANSFER_PATH } from '../../../shared/branding';

const TRANSFER_HASH = '#dissero-transfer=';
const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };

async function transfer(body: unknown): Promise<{ ticket?: string; entries?: unknown }> {
  const response = await fetch(PREFERENCE_TRANSFER_PATH, {
    method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Transferência local indisponível.');
  return response.json();
}

/** Returning false means navigation is in progress; no agents or private configuration are transferred. */
export async function prepareLocalOrigin(): Promise<boolean> {
  const url = new URL(location.href);
  if (url.searchParams.has('mock') || !['http:', 'https:'].includes(url.protocol)) return true;
  const saved = storage();
  if (url.searchParams.get('dissero-legacy') === '1' && url.hostname === LEGACY_LOCAL_HOST) return true;
  if (url.hostname === LEGACY_LOCAL_HOST) {
    try {
      const result = await transfer({ entries: collectPreferences(saved) });
      if (!result.ticket || !/^[A-Za-z0-9_-]{32}$/.test(result.ticket)) throw new Error('Transferência inválida.');
      url.hostname = LOCAL_HOST;
      url.hash = TRANSFER_HASH + result.ticket;
      location.replace(url.href);
      return false;
    } catch { return true; } // The working old address and its preferences remain available.
  }
  if (url.hostname !== LOCAL_HOST) return true;
  if (url.hash.startsWith(TRANSFER_HASH)) {
    const ticket = url.hash.slice(TRANSFER_HASH.length);
    try {
      if (!/^[A-Za-z0-9_-]{32}$/.test(ticket)) throw new Error('Transferência inválida.');
      const result = await transfer({ ticket });
      const entries = parsePreferenceEntries(result.entries);
      if (!entries) throw new Error('Preferências inválidas.');
      if (!importPreferences(saved, entries)) throw new Error('Não foi possível gravar as preferências.');
      saved?.setItem(ORIGIN_READY_KEY, '1');
    } catch {
      // Do not initialize new defaults over an unsuccessful migration.
      if (!saved?.getItem('habblaud:prefs')) throw new Error('Não foi possível transferir as preferências. O endereço anterior continua disponível.');
    }
    url.hash = '';
    history.replaceState(history.state, '', url.href);
    return true;
  }
  if (!saved) return true;
  try { if (saved.getItem(ORIGIN_READY_KEY) || saved.getItem('habblaud:prefs')) return true; } catch { return true; }
  url.hostname = LEGACY_LOCAL_HOST;
  location.replace(url.href);
  return false;
}
