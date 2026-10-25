import { afterEach, expect, it, vi } from 'vitest';
import { WellbeingClient } from './wellbeing';
afterEach(() => vi.unstubAllGlobals());

it('calls the browser fetch with its global receiver rather than binding it to the client', async () => {
  vi.stubGlobal('fetch', function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(new Response('{"ok":true}'));
  });
  expect(await new WellbeingClient().pulse(false)).toEqual({ ok: true });
});

it('sends only the activity flag, exact preferences and explicit action, with bounded requests', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
  const client = new WellbeingClient(fetcher, 'America/Fortaleza', '00000000-0000-4000-8000-000000000001');
  await client.pulse(true);
  await client.configure({ breakAfterMinutes: 50 });
  await client.action('ack', 'break-123');
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0][0]).toBe('/api/wellbeing/pulse?tz=America%2FFortaleza');
  expect(JSON.parse(calls[0][1].body as string)).toEqual({ active: true, clientId: '00000000-0000-4000-8000-000000000001' });
  expect(JSON.parse(calls[1][1].body as string)).toEqual({ breakAfterMinutes: 50 });
  expect(JSON.parse(calls[2][1].body as string)).toEqual({ action: 'ack', id: 'break-123' });
  expect(calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
});
it('keeps local failures actionable instead of returning fabricated empty usage', async () => {
  const client = new WellbeingClient(async () => new Response(JSON.stringify({ error: 'Abra no próprio computador.' }), { status: 403 }));
  await expect(client.snapshot()).rejects.toThrow('próprio computador');
});
