// Isolated, opt-in UI fixture. Never discovers real accounts, reads sessions or executes Codex.
// node --import tsx server/test/question-ui-server.ts
import http from 'node:http';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { createMessageRoutes } from '../messages/http';
import { MessageRegistry } from '../messages/registry';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { CodexQuestions } from '../sources/codex/questions';

const id = 'fixture:codex';
const pending = new CodexQuestions();
pending.start('fixture-question', 'functions.request_user_input_async', { questions: [
  { title: 'Qual formato usar no documento de teste?', options: ['PDF', 'Texto'] },
  { title: 'Qual observação incluir no exemplo fictício?' },
] }, Date.now(), id);
let registry: MessageRegistry;
const office = new Office({ names: new NameStore(null), version: 'fixture', startedAt: Date.now(),
  accounts: () => [], sources: () => [], accountName: () => undefined, terminal: true,
  messages: () => registry?.reachable() ?? new Set() });
const hub = new Hub(office, { throttleMs: 20 });
hub.start();
let received = 0;
registry = new MessageRegistry({ office, codex: { homeOf: () => process.cwd(), run: async job => {
  received++;
  // Ordinary queue acceptance does not resolve a native Codex question.
  return { ok: true };
} } });
registry.start();
const labels = ['Auditoria', 'Pesquisa', 'Contratos', 'Petições', 'Temporária'];
for (const [index, label] of labels.entries()) {
  office.addMain({ id: index === 0 ? id : `fixture:agent-${index}`, provider: 'codex', account: '.codex-fixture',
    sessionId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, cwd: `/synthetic/${label}`,
    role: 'Agente principal', startedAt: Date.now(), status: 'working' });
}
office.setPendingQuestions(id, pending.activities());
office.setStatus(id, 'waiting', 'responder a pergunta sintética');
const accounts = new AccountsService({ dirs: [], home: process.cwd(), env: {}, onChange: () => {} });
const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 'fixture', inDocker: false,
  terminal: true, messages: createMessageRoutes(registry) });
const guard = createRequestGuard();
const server = http.createServer((req, res) => {
  if (guard(req, res)) return;
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/fixture/receipts' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received, remaining: pending.activities().flatMap(a => a.questions ?? []).length, realCodexExecuted: false }));
    return;
  }
  if (!api(req, res, url)) vite.middlewares(req, res);
});
const vite = await createViteServer({ configFile: resolve('vite.config.ts'), server: { middlewareMode: true, ws: { server } }, appType: 'spa' });
await new Promise<void>(ok => server.listen(Number(process.env.QUESTION_UI_PORT ?? 0), '127.0.0.1', ok));
console.log(`QUESTION_UI_URL=http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`);
const stop = () => { registry.stop(); hub.stop(); server.closeAllConnections(); server.close(); void vite.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
