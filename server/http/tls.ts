import { readFileSync } from 'node:fs';
import https from 'node:https';
import type { RequestListener } from 'node:http';

/** Optional HTTPS listener; the ordinary HTTP hook endpoint remains available. */
export function tlsConfig(env: NodeJS.ProcessEnv): { cert: string; key: string; port: number } | undefined {
  const cert = env.HABBLAUD_HTTPS_CERT?.trim();
  const key = env.HABBLAUD_HTTPS_KEY?.trim();
  const rawPort = env.HABBLAUD_HTTPS_PORT?.trim();
  if (!cert && !key && !rawPort) return undefined;
  const port = rawPort ? Number(rawPort) : 443;
  if (!cert || !key || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('HTTPS requires HABBLAUD_HTTPS_CERT, HABBLAUD_HTTPS_KEY and a valid port.');
  }
  return { cert, key, port };
}

export function createTlsListener(env: NodeJS.ProcessEnv, handler: RequestListener) {
  const config = tlsConfig(env);
  if (!config) return undefined;
  return { port: config.port, server: https.createServer({
    cert: readFileSync(config.cert), key: readFileSync(config.key),
  }, handler) };
}
