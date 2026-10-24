import type { IncomingMessage, ServerResponse } from 'node:http';
import { isJsonContentType, isLoopbackHost } from '../http/guard';
import { readJson, sendJson } from '../http/app';
import { InstallError, type UpdateInstaller } from './installer';

export function localInstallRequest(req: IncomingMessage, remote: boolean, post: boolean): boolean {
  const address = req.socket.remoteAddress?.replace(/^::ffff:/i, '');
  if (remote || !address || !(address === '::1' || /^127\.\d+\.\d+\.\d+$/.test(address)) || !isLoopbackHost(req.headers.host)) return false;
  if (!post) return true;
  if (!req.headers.origin || !isJsonContentType(req.headers['content-type'])) return false;
  try {
    const origin = new URL(req.headers.origin);
    const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:';
    return origin.protocol === protocol && origin.host.toLowerCase() === req.headers.host?.trim().toLowerCase() && origin.pathname === '/' && !origin.username && !origin.password;
  } catch { return false; }
}
export async function installRoute(req: IncomingMessage, res: ServerResponse, installer: UpdateInstaller | undefined, remote: boolean): Promise<void> {
  const post = req.method === 'POST';
  res.setHeader('Cache-Control', 'no-store');
  if (!localInstallRequest(req, remote, post)) {
    if (!post && req.method === 'GET') sendJson(res, 200, { supported: false, phase: 'idle', reason: 'Abra o Dissero no próprio computador para instalar atualizações.' });
    else sendJson(res, 403, { error: 'A atualização exige a página local do Dissero.' });
    return;
  }
  if (req.method === 'GET') { sendJson(res, 200, installer?.status() ?? { supported: false, phase: 'idle', reason: 'Instalador indisponível nesta execução.' }); return; }
  if (!post) { res.setHeader('Allow', 'GET, POST'); sendJson(res, 405, { error: 'Método não permitido.' }); return; }
  try {
    if (!installer) throw new InstallError(409, 'Instalador indisponível nesta execução.');
    const body = await readJson(req, 1024) as { version?: unknown } | null;
    if (!body || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'version')) throw new InstallError(400, 'Pedido de atualização inválido.');
    sendJson(res, 202, await installer.start(body.version));
  } catch (error) {
    const status = error instanceof InstallError ? error.status : (error as { status?: number }).status;
    sendJson(res, status && status >= 400 && status < 500 ? status : 502, { error: error instanceof InstallError ? error.message : 'Não foi possível iniciar a atualização.' });
  }
}
