import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferenceTransfers, preferenceTransferRole } from './branding';
import { createApiHandler } from './app';
import { AccountsService } from '../accounts/service';
import { Office } from '../model/office';
import { NameStore } from '../model/names';
import { Hub } from './sse';

describe('preference transfer tickets', () => {
  it('is single use, expires and has a bounded pending-ticket inventory', () => {
    let now = 1;
    const transfers = new PreferenceTransfers(() => now);
    const first = transfers.issue({ 'habblaud:prefs': '{}' });
    expect(transfers.claim(first)).toEqual({ 'habblaud:prefs': '{}' });
    expect(transfers.claim(first)).toBeNull();
    const expired = transfers.issue({});
    now += 180001;
    expect(transfers.claim(expired)).toBeNull();
    const oldest = transfers.issue({});
    for (let i = 0; i < 16; i++) transfers.issue({});
    expect(transfers.claim(oldest)).toBeNull();
  });
  it('requires an explicit local host and the same browser origin', () => {
    const req = (host: string, origin: string | undefined, remoteAddress = '127.0.0.1') => ({ headers: { host, origin }, socket: { remoteAddress } }) as IncomingMessage;
    expect(preferenceTransferRole(req('habblaud.localhost:4748', 'http://habblaud.localhost:4748'))).toBe('source');
    expect(preferenceTransferRole(req('dissero.localhost', 'http://dissero.localhost', '::ffff:127.0.0.1'))).toBe('destination');
    expect(preferenceTransferRole(req('dissero.localhost', undefined))).toBeNull();
    expect(preferenceTransferRole(req('dissero.localhost', 'https://attacker.example'))).toBeNull();
    expect(preferenceTransferRole(req('dissero.localhost', 'https://dissero.localhost'))).toBeNull();
    expect(preferenceTransferRole(req('dissero.localhost', 'http://dissero.localhost', '192.168.0.2'))).toBeNull();
    expect(preferenceTransferRole(req('other.localhost', 'http://other.localhost'))).toBeNull();
    expect(preferenceTransferRole(req('someone@dissero.localhost', 'http://dissero.localhost'))).toBeNull();
  });
});

describe('local branding HTTP transfer', () => {
  let server: http.Server;
  let base: string;
  let remote = false;
  beforeEach(async () => {
    remote = false;
    const office = new Office({ names: new NameStore(null), version: 'test', startedAt: Date.now(), accounts: () => [], sources: () => [], accountName: () => undefined });
    const hub = new Hub(office, { throttleMs: 10 });
    const accounts = new AccountsService({ dirs: [], home: '', env: {}, onChange: () => undefined });
    const handler = createApiHandler({ office, hub, accounts, sources: () => [], version: 'test', inDocker: false, remote: { is: () => remote, allows: () => true } });
    server = http.createServer((req, res) => { handler(req, res, new URL(req.url ?? '/', 'http://localhost')); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const post = (host: string, body: unknown, origin = `http://${host}`) => new Promise<{ status: number; json(): Promise<unknown> }>((resolve, reject) => {
    const req = http.request(`${base}/api/branding/preferences`, { method: 'POST', headers: { host, origin, 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  it('passes settings between the two local origins and rejects ticket replay', async () => {
    const entries = { 'habblaud:prefs': '{"theme":"none","sidebarWidth":419}', 'habblaud.wallets.v1': JSON.stringify({ fixture: 'x'.repeat(75000) }) };
    const created = await post('habblaud.localhost', { entries });
    expect(created.status).toBe(200);
    const { ticket } = await created.json() as { ticket: string };
    const claimed = await post('dissero.localhost', { ticket });
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ entries });
    expect((await post('dissero.localhost', { ticket })).status).toBe(410);
  });
  it('rejects unrelated origins, unknown settings and the remote listener', async () => {
    expect((await post('habblaud.localhost', { entries: {} }, 'https://attacker.example')).status).toBe(403);
    expect((await post('other.localhost', { entries: {} })).status).toBe(403);
    expect((await post('habblaud.localhost', { entries: { token: 'not-a-setting' } })).status).toBe(400);
    remote = true;
    expect((await post('habblaud.localhost', { entries: {} })).status).toBe(403);
  });
});
