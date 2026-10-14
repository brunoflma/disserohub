import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { listSubagentFiles } from './subagents';
import { AsyncSubagentInventory, scanSubagentMetadata, type SubagentSnapshot } from './subagent-inventory';

describe('asynchronous subagent inventory', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => { tmp = tempDir(); });
  afterEach(() => tmp.cleanup());

  it('discovers ordinary and workflow subagents and detects growth and deletion', async () => {
    const base = join(tmp.dir, 'subagents');
    const run = join(base, 'workflows', 'run-1');
    mkdirSync(run, { recursive: true });
    const first = join(base, 'agent-first.jsonl');
    const second = join(run, 'agent-second.jsonl');
    writeFileSync(first, 'a\n'); writeFileSync(second, 'b\n');
    writeFileSync(join(base, 'agent-first.meta.json'), '{}');
    const initial = await scanSubagentMetadata(tmp.dir);
    expect(initial.files).toEqual(listSubagentFiles(tmp.dir));
    expect(initial.metadata.get(first)?.size).toBe(2);
    appendFileSync(first, 'more\n'); rmSync(second);
    const next = await scanSubagentMetadata(tmp.dir);
    expect(next.metadata.get(first)?.size).toBe(7);
    expect(next.files.map(file => file.path)).toEqual([first]);
  });

  it('returns immediately while a scan is pending and does not duplicate work', async () => {
    let resolve!: (snapshot: SubagentSnapshot) => void;
    let reads = 0; let updates = 0;
    const expected = { files: [], metadata: new Map() };
    const inventory = new AsyncSubagentInventory(() => updates++, () => {}, () => 0,
      () => { reads++; return new Promise(done => { resolve = done; }); });
    expect(inventory.current(tmp.dir)).toBeUndefined();
    expect(inventory.current(tmp.dir)).toBeUndefined();
    await new Promise(done => setTimeout(done, 0));
    expect(reads).toBe(1); expect(updates).toBe(0);
    resolve(expected); await inventory.idle();
    expect(inventory.current(tmp.dir)).toBe(expected);
    expect(reads).toBe(1); expect(updates).toBe(1);
    inventory.stop();
  });

  it('keeps the last good result after an I/O failure and recovers on the next scan', async () => {
    let now = 0; let failing = false; let errors = 0;
    const expected = { files: [], metadata: new Map() };
    const inventory = new AsyncSubagentInventory(() => {}, () => errors++, () => now,
      async () => { if (failing) throw new Error('temporary filesystem failure'); return expected; });
    inventory.current(tmp.dir); await inventory.idle();
    failing = true; now += 5000;
    expect(inventory.current(tmp.dir)).toBe(expected); await inventory.idle();
    expect(inventory.current(tmp.dir)).toBe(expected); expect(errors).toBe(1);
    failing = false; now += 5000;
    inventory.current(tmp.dir); await inventory.idle();
    expect(inventory.current(tmp.dir)).toBe(expected); expect(errors).toBe(1);
    inventory.stop();
  });

  it('does not publish results for a session that was removed during the scan', async () => {
    let resolve!: (snapshot: SubagentSnapshot) => void; let updates = 0;
    const inventory = new AsyncSubagentInventory(() => updates++, () => {}, () => 0,
      () => new Promise(done => { resolve = done; }));
    inventory.current(tmp.dir);
    const pending = inventory.idle();
    inventory.forget(tmp.dir);
    resolve({ files: [], metadata: new Map() }); await pending;
    expect(updates).toBe(0);
    inventory.stop();
  });
});
