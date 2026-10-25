import { mkdirSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { WellbeingService } from './service';

it('keeps live metrics usable and reports when persistence fails, then clears the error after retry', () => {
  const root = mkdtempSync(join(tmpdir(), 'dissero-wellbeing-persist-'));
  const file = join(root, 'blocked.json');
  mkdirSync(file);
  const now = Date.parse('2026-10-25T12:00:00Z');
  const service = new WellbeingService({ file, now: () => now, agentsActive: () => true, desktop: () => ({ supported: false, active: false }) });
  try {
    service.load();
    service.configure({ breakAfterMinutes: 90 });
    expect(service.snapshot('UTC').persistence).toBe('error');
    expect(service.snapshot('UTC').preferences.breakAfterMinutes).toBe(90);
    rmdirSync(file);
    service.flush();
    expect(service.snapshot('UTC').persistence).toBe('ok');
  } finally { service.stop(); rmSync(root, { recursive: true, force: true }); }
});
