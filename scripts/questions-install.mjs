// Add only the dedicated local question MCP entry through each client's supported CLI.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NAME = 'dissero-perguntas';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts/questions-mcp.mjs');

function binary(name, explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    if (dir && existsSync(candidate)) return candidate;
  }
  throw new Error(`Executável ${name} não encontrado. Informe o caminho pelo ambiente DISSERO_${name.toUpperCase()}_BIN.`);
}

/** A private, threadless app-server instance only edits this MCP entry's timeout. */
export async function configureCodexTimeout(bin) {
  await new Promise((done, fail) => {
    const child = spawn(bin, ['app-server', '--listen', 'stdio://'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', settled = false;
    const stop = (err) => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.stdin.end();
      const kill = setTimeout(() => child.kill(), 1500); kill.unref();
      child.once('exit', () => clearTimeout(kill));
      if (err) fail(err); else done();
    };
    const timer = setTimeout(() => stop(new Error('O cliente não confirmou o prazo da ferramenta.')), 20_000);
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', () => stop(new Error('Não foi possível iniciar o editor de configuração do Codex.')));
    child.stdin.on('error', () => stop(new Error('O editor de configuração encerrou a conexão.')));
    child.stderr.resume();
    child.on('exit', () => { if (!settled) stop(new Error('O editor de configuração saiu antes da confirmação.')); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return stop(new Error('Resposta de configuração excedeu o limite.'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        let message;
        try { message = JSON.parse(buffer.slice(0, end)); } catch { return stop(new Error('Resposta de configuração inválida.')); }
        buffer = buffer.slice(end + 1);
        if (message.id !== 1 && message.id !== 2) continue;
        if (message.error) return stop(new Error(`O Codex recusou a configuração do MCP (código ${message.error.code}).`));
        if (message.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'config/value/write', params: { keyPath: `mcp_servers.${NAME}.tool_timeout_sec`, value: 660, mergeStrategy: 'replace' } });
        } else stop();
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dissero_question_setup', version: '1.0.0' } } });
  });
}

export async function installQuestions(args = process.argv.slice(2)) {
  let provider = 'both', port = Number(process.env.DISSERO_PORT ?? process.env.HABBLAUD_PORT ?? 4747), dry = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') provider = args[++i];
    else if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i] === '--dry-run') dry = true;
    else throw new Error(`Opção desconhecida: ${args[i]}`);
  }
  if (!['both', 'codex', 'claude'].includes(provider) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use --provider codex|claude|both e uma porta local válida.');
  if (!existsSync(SCRIPT)) throw new Error('O servidor de perguntas não está nesta instalação.');
  const report = [];
  for (const name of provider === 'both' ? ['codex', 'claude'] : [provider]) {
    const bin = binary(name, process.env[`DISSERO_${name.toUpperCase()}_BIN`]);
    const envArgs = [`DISSERO_QUESTION_PROVIDER=${name}`, `DISSERO_PORT=${port}`];
    const command = name === 'codex'
      ? ['mcp', 'add', NAME, '--env', envArgs[0], '--env', envArgs[1], '--', process.execPath, SCRIPT]
      : ['mcp', 'add', NAME, '--scope', 'user', '--transport', 'stdio', '-e', envArgs[0], '-e', envArgs[1], '--', process.execPath, SCRIPT];
    if (dry) { report.push({ provider: name, executable: bin, args: command, codexToolTimeoutSeconds: name === 'codex' ? 660 : undefined }); continue; }
    const current = spawnSync(bin, ['mcp', 'get', NAME, ...(name === 'codex' ? ['--json'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    const existing = current.status === 0;
    let owned = current.stdout?.includes(SCRIPT);
    if (existing && name === 'codex') {
      try { const config = JSON.parse(current.stdout); owned = (config.transport ?? config).args?.includes(SCRIPT); } catch { owned = false; }
    }
    if (existing && !owned) throw new Error(`${NAME} já existe em ${name} com outra configuração; ela foi preservada.`);
    if (!existing) {
      const missing = `${current.stdout ?? ''}\n${current.stderr ?? ''}`;
      if (!/No MCP server|No server|not found|not configured/i.test(missing)) throw new Error(`Não foi possível consultar o MCP dedicado em ${name}; nenhuma configuração foi substituída.`);
      const added = spawnSync(bin, command, { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
      if (added.status !== 0) throw new Error(`Não foi possível registrar ${NAME} em ${name}.`);
    }
    if (name === 'codex') await configureCodexTimeout(bin);
    report.push({ provider: name, status: existing ? 'already_registered' : 'registered', name: NAME,
      activation: 'recarregue os MCPs ou abra uma nova sessão; sessões em execução não foram reiniciadas' });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installQuestions().then(report => console.log(JSON.stringify(report, null, 2)), error => { console.error(error.message); process.exitCode = 1; });
}
