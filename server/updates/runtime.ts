import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

/** Only the fixed, authenticated local supervisor; no HTTP-supplied command or path. */
export function runtimeCommand(dataDir: string, command: 'status' | 'restart'): Promise<{ supervisorPid: number; appPid?: number }> {
  return new Promise((resolve, reject) => {
    let token: string;
    try { token = readFileSync(join(dataDir, 'setup', 'tls', 'runtime-control.token'), 'utf8').trim(); }
    catch { reject(new Error('Serviço nativo indisponível.')); return; }
    if (!/^[a-f0-9]{64}$/.test(token)) { reject(new Error('Serviço nativo indisponível.')); return; }
    const socket = connect('\\\\.\\pipe\\habblaud-native-runtime');
    let body = '';
    socket.setTimeout(command === 'restart' ? 25_000 : 3_000, () => socket.destroy(new Error('Serviço nativo sem resposta.')));
    socket.once('connect', () => socket.write(JSON.stringify({ command, token }) + '\n'));
    socket.on('data', (bytes: Buffer) => {
      body += bytes.toString();
      if (body.length > 32_768) socket.destroy(new Error('Resposta inválida do serviço nativo.'));
    });
    socket.once('error', () => reject(new Error('Serviço nativo indisponível.')));
    socket.once('end', () => {
      try {
        const state = JSON.parse(body);
        if (!Number.isSafeInteger(state.supervisorPid) || state.error) throw new Error();
        resolve(state);
      } catch { reject(new Error('Serviço nativo indisponível.')); }
    });
  });
}
