import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { LEGACY_LOCAL_HOST, LOCAL_HOST, type PreferenceEntries } from '../../shared/branding';

export function preferenceTransferRole(req: IncomingMessage): 'source' | 'destination' | null {
  const address = req.socket.remoteAddress?.replace(/^::ffff:/i, '');
  if (!address || !(address === '::1' || /^127\./.test(address))) return null;
  const scheme = (req.socket as typeof req.socket & { encrypted?: boolean }).encrypted ? 'https:' : 'http:';
  try {
    if (!req.headers.host || !req.headers.origin) return null;
    const page = new URL(`${scheme}//${req.headers.host}`);
    if (page.username || page.password || page.pathname !== '/' || page.search || page.hash) return null;
    if (page.origin !== req.headers.origin) return null;
    return page.hostname === LEGACY_LOCAL_HOST ? 'source' : page.hostname === LOCAL_HOST ? 'destination' : null;
  } catch { return null; }
}

/** One-use tickets; UI preferences never become URL payloads or persisted server data. */
export class PreferenceTransfers {
  private tickets = new Map<string, { expires: number; entries: PreferenceEntries }>();
  constructor(private now = () => Date.now()) {}
  issue(entries: PreferenceEntries): string {
    for (const [ticket, entry] of this.tickets) if (entry.expires <= this.now()) this.tickets.delete(ticket);
    if (this.tickets.size >= 16) this.tickets.delete(this.tickets.keys().next().value!);
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { entries: { ...entries }, expires: this.now() + 180_000 });
    return ticket;
  }
  claim(ticket: string): PreferenceEntries | null {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return entry && entry.expires > this.now() ? entry.entries : null;
  }
}
