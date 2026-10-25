import type { IncomingMessage, ServerResponse } from 'node:http';
import { canonicalTimeZone, systemTimeZone } from '../../shared/daystats';
import { isWellbeingClientId, type WellbeingPreferences } from '../../shared/wellbeing';
import { WellbeingService } from './service';

const BASE = '/api/wellbeing';
const MAX_BODY_BYTES = 2 * 1024;
const PREFERENCE_KEYS = new Set<string>([
  'trackingEnabled',
  'remindersEnabled',
  'breakAfterMinutes',
  'breakMinutes',
  'dailyLimitMinutes',
]);

export type WellbeingRoute = (req: IncomingMessage, res: ServerResponse, url: URL, remote: boolean) => boolean;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.end(JSON.stringify(body));
}

function parseTz(url: URL): string | null {
  const values = url.searchParams.getAll('tz');
  if (values.length > 1) return null;
  return values.length ? canonicalTimeZone(values[0]!) : systemTimeZone();
}

function sameOrigin(req: IncomingMessage): boolean {
  const originHeader = req.headers.origin;
  const host = req.headers.host;
  if (typeof originHeader !== 'string' || typeof host !== 'string' || !host || originHeader === 'null') return false;
  try {
    const origin = new URL(originHeader);
    const protocol = 'encrypted' in req.socket && req.socket.encrypted === true ? 'https:' : 'http:';
    if (origin.protocol !== protocol || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return false;
    return new URL(`${protocol}//${host}`).origin === origin.origin;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function validPreferences(value: Record<string, unknown>): value is Partial<WellbeingPreferences> & Record<string, unknown> {
  if (!Object.keys(value).length || !hasOnlyKeys(value, PREFERENCE_KEYS)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'trackingEnabled' || key === 'remindersEnabled') {
      if (typeof item !== 'boolean') return false;
    } else if (typeof item !== 'number' || !Number.isFinite(item)) return false;
  }
  return true;
}

async function readJson(req: IncomingMessage): Promise<{ value?: unknown; status?: number }> {
  const declaredLength = req.headers['content-length'];
  if (declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    req.resume();
    return { status: 413 };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let oversized = false;
  try {
    for await (const part of req) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        oversized = true;
        chunks.length = 0;
      } else if (!oversized) chunks.push(chunk);
    }
  } catch {
    return { status: 400 };
  }
  if (oversized) return { status: 413 };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    return { status: 400 };
  }
}

function jsonContentType(req: IncomingMessage): boolean {
  const value = req.headers['content-type'];
  return typeof value === 'string' && /^application\/json\s*(;|$)/i.test(value.trim());
}

function parseAction(value: Record<string, unknown>): { action: 'pause' | 'resume' | 'snooze' | 'ack'; id?: string } | null {
  if (!hasOnlyKeys(value, new Set(['action', 'id']))) return null;
  if (value.action !== 'pause' && value.action !== 'resume' && value.action !== 'snooze' && value.action !== 'ack') return null;
  if (value.id !== undefined && (typeof value.id !== 'string' || value.id.length > 96 || /[\u0000-\u001f\u007f]/.test(value.id))) return null;
  return value.id === undefined ? { action: value.action } : { action: value.action, id: value.id };
}

export function createWellbeingRoutes(service: WellbeingService): WellbeingRoute {
  return (req, res, url, remote) => {
    try {
    const path = url.pathname;
    if (path !== BASE && path !== `${BASE}/pulse` && path !== `${BASE}/preferences` && path !== `${BASE}/action`) return false;
    if (remote) {
      sendJson(res, 403, { error: 'forbidden' });
      return true;
    }
    const tz = parseTz(url);
    if (!tz) {
      sendJson(res, 400, { error: 'invalid timezone' });
      return true;
    }
    const method = req.method ?? 'GET';
    if (path === BASE && method === 'GET') {
      sendJson(res, 200, service.snapshot(tz));
      return true;
    }
    if (method !== 'POST' || path === BASE) {
      res.setHeader('Allow', path === BASE ? 'GET' : 'POST');
      sendJson(res, 405, { error: 'method not allowed' });
      return true;
    }
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'same-origin request required' });
      return true;
    }
    if (!jsonContentType(req)) {
      sendJson(res, 415, { error: 'application/json required' });
      return true;
    }

    void readJson(req).then(({ value, status }) => {
      if (status) {
        sendJson(res, status, { error: status === 413 ? 'request body too large' : 'invalid JSON' });
        return;
      }
      if (!isObject(value)) {
        sendJson(res, 400, { error: 'invalid request body' });
        return;
      }
      if (path === `${BASE}/pulse`) {
        if (!hasOnlyKeys(value, new Set(['active', 'clientId'])) || typeof value.active !== 'boolean' || !isWellbeingClientId(value.clientId)) {
          sendJson(res, 400, { error: 'invalid pulse' });
          return;
        }
        if (!service.pulse(value.active, value.clientId)) {
          sendJson(res, 429, { error: 'too many wellbeing clients' });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (path === `${BASE}/preferences`) {
        if (!validPreferences(value)) {
          sendJson(res, 400, { error: 'invalid preferences' });
          return;
        }
        sendJson(res, 200, service.configure(value, tz));
        return;
      }
      const action = parseAction(value);
      if (!action) {
        sendJson(res, 400, { error: 'invalid action' });
        return;
      }
      sendJson(res, 200, service.action(action.action, action.id, tz));
    }).catch(() => sendJson(res, 500, { error: 'wellbeing service unavailable' }));
    return true;
    } catch {
      sendJson(res, 500, { error: 'wellbeing service unavailable' });
      return true;
    }
  };
}
