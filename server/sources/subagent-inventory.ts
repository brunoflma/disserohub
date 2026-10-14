import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_FILE, type SubagentFile } from './subagents';

export interface SubagentSnapshot {
  files: SubagentFile[];
  metadata: Map<string, { size: number; mtimeMs: number }>;
}

async function names(dir: string): Promise<string[]> {
  try { return await readdir(dir); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
}

/** All directory and metadata I/O runs through the filesystem's asynchronous API. */
export async function scanSubagentMetadata(sessionDir: string): Promise<SubagentSnapshot> {
  const base = join(sessionDir, 'subagents');
  const files: SubagentFile[] = [];
  const collect = async (dir: string, runId?: string) => {
    for (const name of await names(dir)) {
      const match = AGENT_FILE.exec(name);
      if (!match) continue;
      files.push({ agentId: match[1], path: join(dir, name), metaPath: join(dir, `agent-${match[1]}.meta.json`), ...(runId ? { runId } : {}) });
    }
  };
  await collect(base);
  for (const run of await names(join(base, 'workflows'))) await collect(join(base, 'workflows', run), run);
  const metadata: SubagentSnapshot['metadata'] = new Map();
  let next = 0;
  // Bound outstanding operations even for sessions with thousands of old subagents.
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        const info = await stat(file.path);
        metadata.set(file.path, { size: info.size, mtimeMs: info.mtimeMs });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }));
  return { files, metadata };
}

interface Scan { requestedAt: number; snapshot?: SubagentSnapshot; job?: Promise<void> }

/** Publish complete scans; retain the last good result while I/O is pending or fails. */
export class AsyncSubagentInventory {
  private scans = new Map<string, Scan>();
  private stopped = false;
  constructor(private readonly onUpdate: () => void, private readonly onError: (error: unknown) => void,
    private readonly now: () => number = Date.now,
    private readonly read: (dir: string) => Promise<SubagentSnapshot> = scanSubagentMetadata) {}

  current(dir: string): SubagentSnapshot | undefined {
    if (this.stopped) return undefined;
    let scan = this.scans.get(dir);
    if (!scan) { scan = { requestedAt: -Infinity }; this.scans.set(dir, scan); }
    const entry = scan;
    if (!entry.job && this.now() - entry.requestedAt >= 5000) {
      entry.requestedAt = this.now();
      entry.job = this.read(dir).then(snapshot => {
        if (this.stopped || this.scans.get(dir) !== entry) return;
        entry.snapshot = snapshot;
        this.onUpdate();
      }).catch(error => { if (!this.stopped && this.scans.get(dir) === entry) this.onError(error); })
        .finally(() => { entry.job = undefined; });
    }
    return entry.snapshot;
  }
  idle(): Promise<void> { return Promise.all([...this.scans.values()].map(scan => scan.job)).then(() => undefined); }
  forget(dir: string): void { this.scans.delete(dir); }
  stop(): void { this.stopped = true; this.scans.clear(); }
}
