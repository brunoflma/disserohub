// Isolated browser fixture: synthetic sessions only; never discovers local accounts or launches agents.
import http from 'node:http';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import type { AgentInfo, OfficeSnapshot, DeliveryInfo, AccessInfo } from '../../shared/types';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectTaskStore } from '../tasks/store';
import { createApiHandler, type ApiDeps } from '../http/app';
import { WellbeingService } from '../wellbeing/service';
import { createWellbeingRoutes } from '../wellbeing/http';
import { listenForFetch } from './fetch-server';

let now = Date.now();
const streams = new Set<http.ServerResponse>();
let scenario = 'basic';
let rev = 1;
let reads = 0;
let writes = 0;
// Start at noon in Fortaleza so the two-hour daily-limit scenario stays in one day.
const RHYTHM_START = Date.parse('2026-11-04T15:00:00Z');
let rhythmNow = RHYTHM_START;
let personalActive = false;
let agentsActive = false;
const makeRhythm = () => new WellbeingService({ file: null, now: () => rhythmNow, agentsActive: () => agentsActive,
  desktop: () => ({ supported: true, active: personalActive, idleMs: 0, sampledAt: rhythmNow }) });
let rhythm = makeRhythm();
let rhythmRoutes = createWellbeingRoutes(rhythm);
const agent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 'fixture:codex', kind: 'main', provider: 'codex', roomId: 'project-a', name: 'Ana', look: 'f', role: 'Agente principal',
  sessionId: '11111111-1111-4111-8111-111111111111', account: 'fixture-codex', status: 'working',
  recent: [], tasks: [], startedAt: now - 100_000, lastEventAt: now - 1_000, statusSince: now - 10_000, seed: 123,
  stats: { toolCalls: 3, tokensIn: 100, tokensOut: 10, subagents: 0 }, ...overrides,
});
function snapshot(): OfficeSnapshot {
  const ended = scenario === 'ended';
  return { rev, serverTime: Date.now(), accounts: [],
    rooms: scenario === 'empty' ? [] : [
      { id: 'project-a', name: 'Projeto Aurora', path: 'D:\\Projetos\\Aurora', slot: 0, seed: 10, createdAt: now - 100_000 },
      { id: 'project-b', name: 'Sala registrada', path: 'D:\\Projetos\\Sala', slot: 1, seed: 20, createdAt: now - 50_000 },
    ],
    agents: scenario === 'empty' ? [] : [agent({ status: ended ? 'done' : 'working', canMessage: true,
      tasks: [{ id: 'task-1', title: 'Conferir filtros do projeto', status: 'in_progress' }],
      pendingQuestions: [{ id: 'native-question', kind: 'ask', icon: '?', text: 'Escolha o escopo', at: now - 20_000,
        questions: [{ index: 0, question: 'Qual escopo revisar no cartão original?', options: [{ index: 0, label: 'Interface' }] }] }],
      permission: { id: 'direct-1', provider: 'codex', channel: 'direct', tool: 'AskUserQuestion', title: 'Pergunta direta', text: 'Qual formato entregar?', icon: '?',
        createdAt: now - 10_000, expiresAt: scenario === 'expired' ? now - 1 : now + 3_600_000,
        questions: [{ index: 0, question: 'Qual formato entregar?', options: [{ index: 0, label: 'PDF' }, { index: 1, label: 'Texto' }] }] },
      recent: [{ id: 'result-1', kind: 'done', icon: '', text: 'Turno concluído', at: now - 40_000 }],
    }), agent({ id: 'fixture:claude', provider: 'claude', account: 'fixture-claude', name: 'Bruno', look: 'm', status: 'waiting',
      canMessage: false, waitingFor: 'Conferir a dependência do projeto', permission: undefined, seed: 456,
      recent: [{ id: 'error-1', kind: 'error', icon: '!', text: 'Falha ao executar verificação', at: now - 15_000 }] }),
    ],
    meta: { demo: scenario === 'demo', startedAt: now - 100_000, version: '1.0.3.2-fixture', terminal: true, messages: true, pty: { enabled: false, reason: 'Desativado no ambiente de teste' },
      sources: [{ label: 'Codex de teste', provider: 'codex', path: 'synthetic-codex', sessions: 1, ok: true },
        { label: 'Claude de teste', provider: 'claude', path: 'synthetic-claude', sessions: 1, ok: true }] },
  };
}
const delivery: DeliveryInfo = { id: 'fixture-delivery', account: 'fixture-codex', provider: 'codex', sessionId: 'fixture', agentId: 'fixture:codex', agentName: 'Ana',
  project: 'd:/projetos/aurora/', request: 'Verificar os filtros', headline: 'Relatório de filtros preparado', text: 'Entrega fictícia para a validação da Central.',
  startedAt: now - 100_000, finishedAt: now - 40_000, tools: 3, edited: 1, attachments: [] };
const pageAccess = (): AccessInfo => ({ local: true, remote: false, permissions: scenario !== 'restricted', messages: scenario !== 'restricted', terminal: scenario !== 'restricted', spawn: false, projects: false, projectTasks: scenario !== 'restricted' && scenario !== 'demo' });
const taskDir = await mkdtemp(join(tmpdir(), 'dissero-work-ui-'));
const taskApi = createApiHandler({
  projectTasks: new ProjectTaskStore(join(taskDir, 'project-tasks.json')),
  office: { isDemo: () => scenario === 'demo', roomPath: (id: string) => snapshot().rooms.find(r => r.id === id)?.path, registerProject: () => undefined },
  deliveries: { list: async () => [delivery] }, inDocker: false,
} as unknown as ApiDeps);
const json = (res: http.ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const publish = () => { for (const stream of streams) stream.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/fixture/reset-tasks' && req.method === 'POST') {
    void writeFile(join(taskDir, 'project-tasks.json'), JSON.stringify({ schema: 1, tasks: [] }), 'utf8').then(() => json(res, { ok: true })); return;
  }
  if (url.pathname === '/fixture/scenario') {
    scenario = url.searchParams.get('name') ?? 'basic'; now = Date.now(); rev++; publish(); return json(res, { scenario });
  }
  if (url.pathname === '/fixture/counters') return json(res, { reads, writes });
  if (url.pathname === '/fixture/disconnect') { for (const stream of streams) stream.end(); streams.clear(); return json(res, { ok: true }); }
  if (url.pathname === '/fixture/rhythm') {
    const name = url.searchParams.get('name') ?? 'reset';
    if (name !== 'advance') {
      rhythmNow = RHYTHM_START; personalActive = name === 'break' || name === 'daily' || name === 'overlap'; agentsActive = name === 'agents-only' || name === 'overlap';
      rhythm = makeRhythm(); rhythmRoutes = createWellbeingRoutes(rhythm);
      rhythm.configure({ trackingEnabled: true, remindersEnabled: true, breakAfterMinutes: 25, breakMinutes: 5, dailyLimitMinutes: 120 });
      rhythm.sample();
    }
    const minutes = name === 'break' ? 25 : name === 'daily' ? 120 : ['agents-only', 'overlap', 'advance'].includes(name) ? 5 : 0;
    for (let i = 0; i < minutes * 12; i++) { rhythmNow += 5000; rhythm.sample(); }
    return json(res, rhythm.snapshot('America/Fortaleza'));
  }
  if (url.pathname.startsWith('/api/wellbeing')) { rhythmRoutes(req, res, url, scenario === 'restricted'); return; }
  if (url.pathname === '/api/access') return json(res, pageAccess());
  if (url.pathname.startsWith('/api/project-tasks')) {
    if (scenario === 'restricted') return json(res, { error: 'Restricted fixture' }, 403);
    if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) writes++;
    taskApi(req, res, url); return;
  }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    streams.add(res); res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    req.on('close', () => streams.delete(res)); return;
  }
  if (url.pathname === '/api/deliveries') { reads++; return json(res, scenario === 'delivery-error' ? { error: 'Fixture error' } : { deliveries: [delivery] }, scenario === 'delivery-error' ? 503 : 200); }
  if (url.pathname === '/api/sessions/recent') return json(res, { sessions: [] });
  if (url.pathname === '/api/permissions/direct-1') return json(res, snapshot().agents[0]?.permission ?? {});
  if (url.pathname.startsWith('/api/agents/')) {
    const a = snapshot().agents.find(a => a.id === decodeURIComponent(url.pathname.slice('/api/agents/'.length)));
    return json(res, a ? { agent: a, timeline: a.recent, subagents: [] } : {}, a ? 200 : 404);
  }
  if (url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) writes++;
    return json(res, { error: 'Unavailable in synthetic fixture' }, 404);
  }
  vite.middlewares(req, res);
});
const vite = await createViteServer({ configFile: resolve('vite.config.ts'), server: { middlewareMode: true, ws: { server }, proxy: {} }, appType: 'spa' });
await listenForFetch(server);
console.log(`WORK_CENTER_UI_URL=http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`);
const stop = () => { for (const stream of streams) stream.end(); server.closeAllConnections(); server.close(); void vite.close().then(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
