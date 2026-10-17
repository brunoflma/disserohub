// Real stdio MCP subprocess + real guarded HTTP routes. No model, real session or message queue.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX_MAIN, CODEX_THREAD, MAIN, SESSION, request, servePermissions, type PermissionServer } from './permission-server';

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });

async function client(provider: 'codex' | 'claude', opts: { viewers?: number } = {}) {
  const server = await servePermissions({ codex: true, ...opts });
  closers.push(() => server.close());
  const child = spawn(process.execPath, [resolve('scripts/questions-mcp.mjs')], { windowsHide: true,
    env: { ...process.env, DISSERO_PORT: String(server.port), DISSERO_QUESTION_PROVIDER: provider }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, (value: any) => void>();
  let buffer = '', seq = 0;
  const messages: any[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      messages.push(message);
      if (typeof message.id === 'number') { pending.get(message.id)?.(message); pending.delete(message.id); }
    }
  });
  const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const rpc = (method: string, params: object = {}, id = ++seq) => new Promise<any>(done => { pending.set(id, done); send({ id, method, params }); });
  closers.push(() => new Promise<void>(done => {
    if (child.exitCode !== null) return done();
    const timer = setTimeout(() => child.kill(), 2500);
    child.once('exit', () => { clearTimeout(timer); done(); }); child.stdin.end();
  }));
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-test', version: '1' } });
  expect(init.result.protocolVersion).toBe('2025-06-18');
  send({ method: 'notifications/initialized' });
  return { server, rpc, send, messages };
}

async function questionId(server: PermissionServer, agentId: string) {
  await vi.waitFor(() => expect(server.registry?.snapshot().get(agentId)?.channel).toBe('direct'), { timeout: 4000, interval: 20 });
  return server.registry!.snapshot().get(agentId)!.id;
}

// Windows may need several seconds to start a child process; delivery itself stays under 1.5 s.
describe('Dissero immediate MCP answers', { timeout: 20_000 }, () => {
  it.each(['codex', 'claude'] as const)('%s receives the answer on its live tool call while the turn is still working', async provider => {
    const cli = await client(provider);
    const session = provider === 'codex' ? CODEX_THREAD : SESSION;
    const agent = provider === 'codex' ? CODEX_MAIN : MAIN;
    expect((await cli.rpc('tools/list')).result.tools.map((t: any) => t.name)).toEqual(['ask_user']);
    expect((await request(cli.server.base, '/api/health')).json).toMatchObject({ messages: false });
    const answer = cli.rpc('tools/call', { name: 'ask_user', arguments: { session_id: session, questions: [
      { question: 'Qual formato?', options: [{ label: 'PDF' }, { label: 'Texto' }] },
      { question: 'Qual formato?' },
    ] } });
    const id = await questionId(cli.server, agent);
    expect((await cli.rpc('ping')).result).toEqual({});
    const at = Date.now();
    expect((await request(cli.server.base, `/api/permissions/${id}/decision`, { method: 'POST', body: {
      behavior: 'answer', answers: [{ question: 0, options: [1] }, { question: 1, other: 'Resposta fictícia imediata' }],
    } })).status).toBe(200);
    const delivered = (await answer).result;
    expect(Date.now() - at).toBeLessThan(1500);
    expect(delivered.structuredContent).toMatchObject({ status: 'answered', request_id: id,
      answers: [{ question: 0, text: 'Texto' }, { question: 1, text: 'Resposta fictícia imediata' }] });
    expect(cli.server.office.get(agent)?.status).toBe('working');
    expect(cli.server.registry!.size).toBe(0);
    expect(JSON.stringify(delivered)).not.toContain('send_user_message_question_reply');
  });

  it('withdraws only the cancelled tool call and does not turn cancellation into an answer', async () => {
    const cli = await client('codex');
    const answer = cli.rpc('tools/call', { name: 'ask_user', arguments: { session_id: CODEX_THREAD, questions: [{ question: 'Continuar?' }] } }, 100);
    await questionId(cli.server, CODEX_MAIN);
    cli.send({ method: 'notifications/cancelled', params: { requestId: 100, reason: 'synthetic cancellation' } });
    expect((await answer).result).toMatchObject({ isError: true });
    expect(cli.server.registry!.size).toBe(0);
  });

  it('fails promptly when no viewer or exact session is available', async () => {
    const cli = await client('codex', { viewers: 0 });
    const args = { session_id: CODEX_THREAD, questions: [{ question: 'Continuar?' }] };
    expect((await cli.rpc('tools/call', { name: 'ask_user', arguments: args })).result).toMatchObject({ isError: true });
    cli.server.setViewers(1);
    expect((await cli.rpc('tools/call', { name: 'ask_user', arguments: { ...args, session_id: 'not-this-session' } })).result).toMatchObject({ isError: true });
    expect(cli.server.registry!.size).toBe(0);
  });

  it('rejects reused MCP request ids with different questions instead of replaying another answer', async () => {
    const cli = await client('codex', { viewers: 0 });
    const params = { name: 'ask_user', arguments: { session_id: CODEX_THREAD, questions: [{ question: 'Primeira?' }] } };
    expect((await cli.rpc('tools/call', params, 100)).result.isError).toBe(true);
    expect((await cli.rpc('tools/call', { ...params, arguments: { ...params.arguments, questions: [{ question: 'Outra?' }] } }, 100)).error.code).toBe(-32600);
    expect(cli.server.registry!.size).toBe(0);
  });

  it('keeps local Host, JSON and Origin guards on direct registrations', async () => {
    const cli = await client('codex');
    const body = { provider: 'codex', session_id: CODEX_THREAD, request_key: 'synthetic-guard-0001', questions: [{ question: 'Continuar?' }] };
    for (const [headers, status] of [[{ Host: 'habblaud.lan' }, 403], [{ Origin: 'https://untrusted.example' }, 403], [{ 'Content-Type': 'text/plain' }, 415]] as const) {
      expect((await request(cli.server.base, '/api/permissions/questions', { method: 'POST', body, headers })).status).toBe(status);
    }
    expect(cli.server.registry!.size).toBe(0);
  });
});
