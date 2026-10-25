import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WellbeingService } from './service';
import { createWellbeingRoutes } from './http';

const services: WellbeingService[] = [];
const servers: Server[] = [];
let remote = false;

function service(): WellbeingService {
  const instance = new WellbeingService({
    file: null,
    now: () => Date.UTC(2026, 9, 25, 12),
    agentsActive: () => false,
    desktop: () => ({ supported: false, active: false }),
  });
  instance.load();
  services.push(instance);
  return instance;
}

async function listen(wellbeing: WellbeingService): Promise<{ base: string; close: () => Promise<void> }> {
  remote = false;
  const routes = createWellbeingRoutes(wellbeing);
  const server = createServer((req, res) => {
    const host = req.headers.host ?? '127.0.0.1';
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (routes(req, res, url, remote)) return;
    res.statusCode = 404;
    res.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const item of services.splice(0)) item.stop();
  remote = false;
});

describe('wellbeing HTTP boundary', () => {
  it('serves a timezone-aware report and rejects duplicate or invalid timezones', async () => {
    const { base } = await listen(service());
    const ok = await fetch(`${base}/api/wellbeing?tz=America%2FSao_Paulo`);
    expect(ok.status).toBe(200);
    const report = await ok.json();
    expect(report.periods.week.days).toHaveLength(7);
    expect((await fetch(`${base}/api/wellbeing?tz=UTC&tz=UTC`)).status).toBe(400);
    expect((await fetch(`${base}/api/wellbeing?tz=not/a-zone`)).status).toBe(400);
  });

  it('rejects remote calls and POSTs without exact same-origin JSON', async () => {
    const { base } = await listen(service());
    remote = true;
    expect((await fetch(`${base}/api/wellbeing`)).status).toBe(403);
    remote = false;

    const noOrigin = await fetch(`${base}/api/wellbeing/pulse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    expect(noOrigin.status).toBe(403);

    const wrongOrigin = await fetch(`${base}/api/wellbeing/pulse`, {
      method: 'POST',
      headers: { Origin: 'http://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    expect(wrongOrigin.status).toBe(403);

    const wrongScheme = await fetch(`${base}/api/wellbeing/pulse`, {
      method: 'POST',
      headers: { Origin: base.replace('http:', 'https:'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    expect(wrongScheme.status).toBe(403);

    const wrongType = await fetch(`${base}/api/wellbeing/pulse`, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ active: true }),
    });
    expect(wrongType.status).toBe(415);
  });

  it('rejects unknown body keys and oversized payloads, and clamps allowed preferences', async () => {
    const { base } = await listen(service());
    const headers = { Origin: base, 'Content-Type': 'application/json' };
    const extra = await fetch(`${base}/api/wellbeing/pulse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ active: true, clientId: '00000000-0000-4000-8000-000000000001', title: 'private' }),
    });
    expect(extra.status).toBe(400);

    const invalidClient = await fetch(`${base}/api/wellbeing/pulse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ active: true, clientId: 'not-a-client-id' }),
    });
    expect(invalidClient.status).toBe(400);

    const pulse = await fetch(`${base}/api/wellbeing/pulse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ active: true, clientId: '00000000-0000-4000-8000-000000000001' }),
    });
    expect(pulse.status).toBe(200);
    expect(await pulse.json()).toEqual({ ok: true });

    const large = await fetch(`${base}/api/wellbeing/preferences`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ breakMinutes: 5, extra: 'x'.repeat(2_100) }),
    });
    expect(large.status).toBe(413);

    const preferences = await fetch(`${base}/api/wellbeing/preferences`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ breakAfterMinutes: 2, breakMinutes: 45, dailyLimitMinutes: 999 }),
    });
    expect(preferences.status).toBe(200);
    expect((await preferences.json()).preferences).toMatchObject({ breakAfterMinutes: 20, breakMinutes: 30, dailyLimitMinutes: 720 });
  });

  it('validates action names and permits same-origin pause actions', async () => {
    const { base } = await listen(service());
    const headers = { Origin: base, 'Content-Type': 'application/json' };
    const bad = await fetch(`${base}/api/wellbeing/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'delete' }) });
    expect(bad.status).toBe(400);
    const good = await fetch(`${base}/api/wellbeing/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'pause' }) });
    expect(good.status).toBe(200);
    expect((await good.json()).current.breakUntil).toBeGreaterThan(0);
  });
});
