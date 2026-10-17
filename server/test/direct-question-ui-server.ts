// Isolated UI + actual MCP subprocess. Synthetic session only; no accounts or model calls.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { createPermissionRoutes } from '../permissions/http';
import { PermissionRegistry } from '../permissions/registry';

const session = '11111111-1111-4111-8111-111111111111', id = `fixture:${session}`;
let registry: PermissionRegistry;
const office = new Office({ names: new NameStore(null), version: '1.0.3.2-fixture', startedAt: Date.now(),
  accounts: () => [], sources: () => [], accountName: () => undefined, terminal: true,
  permissions: () => registry?.snapshot() ?? new Map() });
office.addMain({ id, sessionId: session, provider: 'codex', account: '.codex-fixture', cwd: '/synthetic/Perguntas',
  role: 'Agente principal', status: 'working', startedAt: Date.now() });
registry = new PermissionRegistry({ office, viewers: () => 1 }); registry.start();
const hub = new Hub(office, { throttleMs: 20 }); hub.start();
const accounts = new AccountsService({ dirs: [], home: process.cwd(), env: {}, onChange: () => {} });
const api = createApiHandler({ office, hub, accounts, sources: () => [], version: '1.0.3.2-fixture', inDocker: false,
  terminal: true, permissions: createPermissionRoutes(registry) });
const guard = createRequestGuard();
let result: unknown, callReturnedAt: number | undefined;
const server = http.createServer((req, res) => {
  if (guard(req, res)) return;
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/fixture/result' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return void res.end(JSON.stringify({ result, callReturnedAt, agentStatus: office.get(id)?.status, pending: registry.size, queuedMessages: 0 }));
  }
  if (!api(req, res, url)) vite.middlewares(req, res);
});
const vite = await createViteServer({ configFile: resolve('vite.config.ts'), server: { middlewareMode: true, ws: { server } }, appType: 'spa' });
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const port = (server.address() as import('node:net').AddressInfo).port;
const child = spawn(process.execPath, [resolve('scripts/questions-mcp.mjs')], { windowsHide: true,
  env: { ...process.env, DISSERO_PORT: String(port), DISSERO_QUESTION_PROVIDER: 'codex' }, stdio: ['pipe', 'pipe', 'pipe'] });
const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
let buffer = '';
child.stderr.resume(); child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const response = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (response.id === 1) {
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/call', params: { name: 'ask_user', arguments: { session_id: session, questions: [
        { question: 'Qual formato usar no teste da resposta direta?', options: [{ label: 'PDF' }, { label: 'Texto' }] },
        { question: 'Qual observação incluir no teste fictício?' },
      ] } } });
    }
    if (response.id === 2) { result = response.result; callReturnedAt = Date.now(); }
  }
});
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'isolated-ui-test', version: '1' } } });
console.log(`DIRECT_QUESTION_UI_URL=http://127.0.0.1:${port}`);
const stop = () => { child.stdin.end(); registry.stop(); hub.stop(); server.closeAllConnections(); server.close(); void vite.close().then(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
