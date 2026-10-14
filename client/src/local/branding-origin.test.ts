import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGIN_READY_KEY } from '../../../shared/branding';
import { prepareLocalOrigin } from './branding-origin';

function browser(href: string, initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const replace = vi.fn();
  const replaceState = vi.fn();
  vi.stubGlobal('location', { href, replace });
  vi.stubGlobal('history', { state: null, replaceState });
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  return { values, replace, replaceState };
}
afterEach(() => vi.unstubAllGlobals());

describe('Dissero origin transition', () => {
  it('sends only UI settings and puts only a one-use ticket in the new URL', async () => {
    const b = browser('https://habblaud.localhost/?app=1', { 'habblaud:prefs': '{"theme":"none"}', credential: 'never-transfer' });
    const send = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ ticket: 'a'.repeat(32) }), { status: 200 }));
    vi.stubGlobal('fetch', send);
    expect(await prepareLocalOrigin()).toBe(false);
    expect(JSON.parse(send.mock.calls[0]![1].body as string)).toEqual({ entries: { 'habblaud:prefs': '{"theme":"none"}' } });
    const target = new URL(b.replace.mock.calls[0][0]);
    expect(target.hostname).toBe('dissero.localhost');
    expect(target.search).toBe('?app=1');
    expect(target.hash).toBe('#dissero-transfer=' + 'a'.repeat(32));
    expect(target.href).not.toContain('theme');
    expect(b.values.get('habblaud:prefs')).toBe('{"theme":"none"}');
  });
  it('imports settings before app startup and clears the temporary URL', async () => {
    const b = browser('https://dissero.localhost/#dissero-transfer=' + 'b'.repeat(32));
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ entries: { 'habblaud:prefs': '{"theme":"none"}' } }), { status: 200 }));
    expect(await prepareLocalOrigin()).toBe(true);
    expect(b.values.get('habblaud:prefs')).toBe('{"theme":"none"}');
    expect(b.values.get(ORIGIN_READY_KEY)).toBe('1');
    expect(b.replaceState.mock.calls[0][2]).toBe('https://dissero.localhost/');
  });
  it('visits the old origin once when opening the new address without existing settings', async () => {
    const b = browser('https://dissero.localhost/');
    expect(await prepareLocalOrigin()).toBe(false);
    expect(b.replace).toHaveBeenCalledWith('https://habblaud.localhost/');
  });
  it('keeps a failed migration from creating replacement defaults', async () => {
    const b = browser('https://dissero.localhost/#dissero-transfer=' + 'c'.repeat(32));
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 410 }));
    await expect(prepareLocalOrigin()).rejects.toThrow('Não foi possível transferir');
    expect(b.values.has('habblaud:prefs')).toBe(false);
  });
  it('leaves the fallback address, mock mode and nonlocal hosts usable', async () => {
    for (const href of ['https://habblaud.localhost/?dissero-legacy=1', 'https://habblaud.localhost/?mock=1', 'http://127.0.0.1:4748/']) {
      const b = browser(href);
      expect(await prepareLocalOrigin()).toBe(true);
      expect(b.replace).not.toHaveBeenCalled();
    }
  });
  it('does not start with replacement defaults when the destination storage refuses writes', async () => {
    browser('https://dissero.localhost/#dissero-transfer=' + 'd'.repeat(32));
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ entries: { 'habblaud:prefs': '{"theme":"none"}' } }), { status: 200 }));
    await expect(prepareLocalOrigin()).rejects.toThrow('Não foi possível transferir');
  });
});
