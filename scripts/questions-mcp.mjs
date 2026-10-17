// Local stdio MCP: its live tools/call receives the user's answer, never a queued chat message.
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_LINE = 256 * 1024;
const VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
export const questionTool = {
  name: 'ask_user',
  description: 'Faça perguntas ao usuário no Dissero e aguarde a resposta nesta chamada. A resposta é direta, sem fila de mensagens. No Codex, informe em session_id o CODEX_THREAD_ID da própria sessão (leia somente essa variável pela ferramenta de terminal). No Claude, o processo da sessão é identificado automaticamente quando possível. Se o canal não estiver disponível, explique o erro e use o cliente de origem; não envie respostas por codex queue.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['questions'], properties: {
    session_id: { type: 'string', maxLength: 200, description: 'ID da própria sessão atual; obrigatório no Codex.' },
    timeout_seconds: { type: 'integer', minimum: 5, maximum: 600, default: 300 },
    questions: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false,
      required: ['question'], properties: {
        question: { type: 'string', minLength: 1, maxLength: 2000 },
        header: { type: 'string', maxLength: 32 }, multiSelect: { type: 'boolean' },
        options: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['label'], properties: {
          label: { type: 'string', minLength: 1, maxLength: 160 }, description: { type: 'string', maxLength: 1000 },
        } } },
      } } },
  } },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

function validate(args) {
  if (!args || typeof args !== 'object' || !Array.isArray(args.questions) || !args.questions.length || args.questions.length > 4) throw new Error('Informe de uma a quatro perguntas.');
  if (args.session_id !== undefined && (typeof args.session_id !== 'string' || !args.session_id.trim() || args.session_id.length > 200)) throw new Error('session_id inválido.');
  if (args.timeout_seconds !== undefined && (!Number.isInteger(args.timeout_seconds) || args.timeout_seconds < 5 || args.timeout_seconds > 600)) throw new Error('Prazo inválido: use de 5 a 600 segundos.');
  for (const q of args.questions) {
    if (!q || typeof q.question !== 'string' || !q.question.trim() || q.question.length > 2000) throw new Error('Enunciado da pergunta inválido.');
    if (q.header !== undefined && (typeof q.header !== 'string' || q.header.length > 32)) throw new Error('Cabeçalho inválido.');
    if (q.multiSelect !== undefined && typeof q.multiSelect !== 'boolean') throw new Error('multiSelect inválido.');
    if (q.options !== undefined && (!Array.isArray(q.options) || q.options.length > 6)) throw new Error('Alternativas inválidas.');
    for (const o of q.options ?? []) if (!o || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 160
      || o.description !== undefined && (typeof o.description !== 'string' || o.description.length > 1000)) throw new Error('Alternativa inválida.');
  }
  return args;
}

export async function askDirect(args, { base, provider, requestKey, clientPid = process.ppid, signal, progress = () => {} }) {
  validate(args);
  if (provider === 'codex' && !args.session_id) throw new Error('Informe em session_id o CODEX_THREAD_ID da própria sessão.');
  const timeoutMs = (args.timeout_seconds ?? 300) * 1000;
  const deadline = Date.now() + timeoutMs;
  const request = async (path, body, timeout = 4000) => {
    const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
    const result = await res.json();
    if (!res.ok) throw new Error(`Dissero: ${result.error ?? `HTTP ${res.status}`}`);
    return result;
  };
  let id, finished = false;
  const timer = setInterval(progress, 10_000);
  timer.unref();
  try {
    const reg = await request('/api/permissions/questions', { provider, session_id: args.session_id,
      client_pid: clientPid, questions: args.questions, timeout_ms: timeoutMs, request_key: requestKey });
    if (reg.skip) throw new Error(reg.skip === 'no-viewers' ? 'Abra o Dissero no navegador antes de perguntar.'
      : reg.skip === 'unknown-session' ? 'A própria sessão não foi identificada no Dissero. Confira session_id e o monitoramento do cliente.'
        : `Pergunta indisponível no Dissero: ${reg.skip}`);
    if (typeof reg.id !== 'string' || !reg.id.startsWith('p-')) throw new Error('Registro de pergunta inválido.');
    id = reg.id;
    progress();
    while (Date.now() < deadline) {
      const seconds = Math.min(25, Math.max(0.05, (deadline - Date.now()) / 1000));
      const result = await request(`/api/permissions/${encodeURIComponent(id)}/wait?timeout=${seconds}`, undefined, seconds * 1000 + 3000);
      if (result.status === 'pending') continue;
      finished = true;
      if (result.status === 'decided' && result.behavior === 'answer') {
        if (!Array.isArray(result.answers) || result.answers.length !== args.questions.length) throw new Error('Resposta incompleta do Dissero.');
        const seen = new Set();
        const answers = result.answers.map(answer => {
          const q = args.questions[answer.question];
          if (!q || seen.has(answer.question)) throw new Error('Resposta de outra pergunta.');
          seen.add(answer.question);
          const selected = (answer.options ?? []).map(index => {
            if (!Number.isInteger(index) || !q.options?.[index]) throw new Error('Alternativa desconhecida.');
            return q.options[index].label;
          });
          if (answer.other) selected.push(answer.other);
          if (!selected.length) throw new Error('Resposta vazia.');
          return { question: answer.question, text: selected.join('\n') };
        });
        return { status: 'answered', request_id: id, answers };
      }
      if (result.status !== 'released' && !(result.status === 'decided' && result.behavior === 'deny')) throw new Error('Decisão inválida para uma pergunta.');
      return { status: 'cancelled', request_id: id, reason: result.reason ?? 'declined', message: result.message,
        instruction: 'Sem resposta do usuário; não interprete isso como autorização.' };
    }
    return { status: 'expired', request_id: id, instruction: 'A pergunta expirou sem resposta; não interprete isso como autorização.' };
  } finally {
    clearInterval(timer);
    if (id && !finished) {
      // Cancellation only withdraws this exact call. It never submits an answer or replays registration.
      try { await fetch(`${base}/api/permissions/${encodeURIComponent(id)}/decision`, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ behavior: 'terminal' }), signal: AbortSignal.timeout(2000) }); } catch {}
    }
  }
}

export function serveQuestions({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const port = Number(env.DISSERO_PORT ?? env.HABBLAUD_PORT ?? 4747);
  const provider = env.DISSERO_QUESTION_PROVIDER;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['codex', 'claude'].includes(provider)) throw new Error('Configure DISSERO_PORT e DISSERO_QUESTION_PROVIDER (codex ou claude).');
  const base = `http://127.0.0.1:${port}`, nonce = randomUUID();
  const active = new Map(), replies = new Map();
  let initialized = false, buffer = '';
  const send = message => output.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const error = (id, code, message) => send({ id, error: { code, message } });
  const handle = async req => {
    if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return error(null, -32600, 'Invalid Request');
    if (req.method === 'notifications/cancelled') { active.get(JSON.stringify(req.params?.requestId))?.controller.abort(); return; }
    if (req.id === undefined) return;
    if (!(typeof req.id === 'string' && req.id.length <= 200 || Number.isSafeInteger(req.id))) return error(null, -32600, 'Invalid request id');
    if (req.method === 'initialize') {
      if (initialized) return error(req.id, -32600, 'Already initialized');
      initialized = true;
      return send({ id: req.id, result: { protocolVersion: VERSIONS.includes(req.params?.protocolVersion) ? req.params.protocolVersion : VERSIONS.at(-1),
        capabilities: { tools: {} }, serverInfo: { name: 'dissero-perguntas', version: '1.0.0' },
        instructions: 'Para perguntar ao usuário pelo Dissero, use ask_user e aguarde seu resultado. No Codex, leia CODEX_THREAD_ID da própria sessão e passe em session_id. A chamada devolve a resposta diretamente. Não converta a resposta em mensagem de fila.' } });
    }
    if (!initialized) return error(req.id, -32002, 'Not initialized');
    if (req.method === 'ping') return send({ id: req.id, result: {} });
    if (req.method === 'tools/list') return send({ id: req.id, result: { tools: [questionTool] } });
    if (req.method !== 'tools/call') return error(req.id, -32601, 'Method not found');
    if (req.params?.name !== 'ask_user') return error(req.id, -32602, 'Unknown tool');
    const key = JSON.stringify(req.id);
    const fingerprint = createHash('sha256').update(JSON.stringify(req.params.arguments ?? null)).digest('hex');
    const previous = replies.get(key) ?? active.get(key);
    if (previous && previous.fingerprint !== fingerprint) return error(req.id, -32600, 'Request id reused with different arguments');
    if (replies.has(key)) return send(replies.get(key).reply);
    if (active.has(key)) return;
    if (active.size >= 8) return error(req.id, -32000, 'Too many pending questions');
    const controller = new AbortController(); active.set(key, { controller, fingerprint });
    let count = 0;
    const token = req.params?._meta?.progressToken;
    const progress = () => { if (typeof token === 'string' || typeof token === 'number') send({ method: 'notifications/progress', params: {
      progressToken: token, progress: ++count, message: 'Aguardando sua resposta no Dissero' } }); };
    let result;
    try {
      const answer = await askDirect(req.params.arguments, { base, provider, requestKey: `${nonce}:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`,
        signal: controller.signal, progress });
      result = { content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer };
    } catch (err) {
      result = { isError: true, content: [{ type: 'text', text: controller.signal.aborted ? 'Pergunta cancelada pelo cliente, sem resposta.' : `Não foi possível obter a resposta: ${String(err.message).slice(0, 500)}` }] };
    } finally { active.delete(key); }
    const reply = { id: req.id, result }; replies.set(key, { reply, fingerprint });
    if (replies.size > 32) replies.delete(replies.keys().next().value);
    send(reply);
  };
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_LINE) { error(null, -32600, 'Request too large'); input.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      try { void handle(JSON.parse(line)); } catch { error(null, -32700, 'Parse error'); }
    }
  });
  const close = () => { for (const { controller } of active.values()) controller.abort(); };
  input.on('end', close); input.on('error', close);
  return { close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = serveQuestions();
  process.on('SIGINT', () => { server.close(); process.stdin.destroy(); });
  process.on('SIGTERM', () => { server.close(); process.stdin.destroy(); });
}
