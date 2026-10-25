import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { WindowsFocusMonitor } from './windows-focus';

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  killCount = 0;

  kill(): boolean {
    this.killCount += 1;
    return true;
  }

  send(line: string): void {
    this.stdout.emit('data', Buffer.from(`${line}\n`, 'utf8'));
  }
}

function createMonitor(options: { platform?: NodeJS.Platform; disabled?: boolean; initialTime?: number } = {}) {
  const child = new FakeChild();
  let time = options.initialTime ?? 1000;
  let command: string | undefined;
  let args: string[] | undefined;
  let spawnOptions: unknown;
  const spawn = vi.fn((exe: string, argv: string[], spawnOptionsArg: unknown) => {
    command = exe;
    args = argv;
    spawnOptions = spawnOptionsArg;
    return child;
  });
  const monitor = new WindowsFocusMonitor({
    platform: options.platform ?? 'win32',
    disabled: options.disabled,
    spawn: spawn as never,
    now: () => time,
  });
  return {
    child,
    monitor,
    spawn,
    get command() { return command; },
    get args() { return args; },
    get spawnOptions() { return spawnOptions; },
    setTime(next: number) { time = next; },
  };
}

describe('WindowsFocusMonitor', () => {
  it('starts one hidden helper and limits focus classification to the requested process names', () => {
    const fixture = createMonitor();
    fixture.monitor.start();
    fixture.monitor.start();

    expect(fixture.spawn).toHaveBeenCalledTimes(1);
    expect(fixture.command).toBe('powershell.exe');
    expect(fixture.spawnOptions).toEqual({ shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const helper = fixture.args?.at(-1) ?? '';
    expect(helper).toContain('"codex"');
    expect(helper).toContain('"chatgpt"');
    expect(helper).toContain('"claude"');
    expect(helper).not.toMatch(/chrome|msedge|firefox|GetWindowText|GetAsyncKeyState|screenshot|https?:/i);
    expect(helper).toContain('Start-Sleep -Milliseconds 5000');
  });

  it('reports activity only for a fresh allowlisted helper sample within the idle limit', () => {
    const fixture = createMonitor();
    fixture.monitor.start();
    expect(fixture.monitor.snapshot()).toEqual({ supported: true, active: false });

    fixture.child.send('{"active":true,"idleMs":120000}');
    expect(fixture.monitor.snapshot()).toMatchObject({ supported: true, active: true, idleMs: 120000, sampledAt: 1000 });

    fixture.child.send('{"active":true,"idleMs":120001}');
    expect(fixture.monitor.snapshot()).toMatchObject({ supported: true, active: false, idleMs: 120001 });

    fixture.child.send('{"active":false,"idleMs":1}');
    expect(fixture.monitor.snapshot()).toMatchObject({ supported: true, active: false, idleMs: 1 });
  });

  it('accepts helper output split across stdout chunks', () => {
    const fixture = createMonitor();
    fixture.monitor.start();
    fixture.child.stdout.emit('data', Buffer.from('{"active":true,"idle', 'utf8'));
    fixture.child.stdout.emit('data', Buffer.from('Ms":5}\r\n', 'utf8'));
    expect(fixture.monitor.snapshot()).toMatchObject({ supported: true, active: true, idleMs: 5 });
  });

  it('fails closed for stale samples', () => {
    const fixture = createMonitor();
    fixture.monitor.start();
    fixture.child.send('{"active":true,"idleMs":5}');
    fixture.setTime(15_999);
    expect(fixture.monitor.snapshot().active).toBe(true);
    fixture.setTime(16_000);
    expect(fixture.monitor.snapshot()).toEqual({ supported: true, active: false });
  });

  it.each([
    ['malformed JSON', 'not-json'],
    ['non-finite JSON number', '{"active":true,"idleMs":1e999}'],
    ['negative idle', '{"active":true,"idleMs":-1}'],
    ['oversize idle', '{"active":true,"idleMs":4294967296}'],
    ['unexpected output field', '{"active":true,"idleMs":1,"processName":"claude"}'],
  ])('fails closed for %s helper output', (_label, line) => {
    const fixture = createMonitor();
    fixture.monitor.start();
    fixture.child.send('{"active":true,"idleMs":5}');
    expect(fixture.monitor.snapshot().active).toBe(true);
    fixture.child.send(line);
    expect(fixture.monitor.snapshot()).toEqual({ supported: true, active: false });
  });

  it.each(['error', 'close'] as const)('fails closed after helper %s and does not restart it', (event) => {
    const fixture = createMonitor();
    fixture.monitor.start();
    fixture.child.send('{"active":true,"idleMs":5}');
    expect(fixture.monitor.snapshot().active).toBe(true);

    if (event === 'error') fixture.child.emit('error', new Error('helper failed'));
    else fixture.child.emit('close', 1, null);
    expect(fixture.monitor.snapshot()).toEqual({ supported: true, active: false });
    fixture.monitor.start();
    expect(fixture.spawn).toHaveBeenCalledTimes(1);
  });

  it('fails closed when spawning throws', () => {
    const spawn = vi.fn(() => { throw new Error('spawn failed'); });
    const monitor = new WindowsFocusMonitor({ platform: 'win32', spawn: spawn as never });
    expect(() => monitor.start()).not.toThrow();
    expect(monitor.snapshot()).toEqual({ supported: true, active: false });
    monitor.start();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does not start the helper on unsupported platforms', () => {
    const fixture = createMonitor({ platform: 'linux' });
    fixture.monitor.start();
    expect(fixture.spawn).not.toHaveBeenCalled();
    expect(fixture.monitor.snapshot()).toEqual({ supported: false, active: false });
  });

  it('honors the disabled option without starting the helper', () => {
    const fixture = createMonitor({ disabled: true });
    fixture.monitor.start();
    expect(fixture.spawn).not.toHaveBeenCalled();
    expect(fixture.monitor.snapshot()).toEqual({ supported: true, active: false });
  });

  it('stops only its owned child and clears the last sample', () => {
    const fixture = createMonitor();
    fixture.monitor.start();
    fixture.child.send('{"active":true,"idleMs":5}');
    expect(fixture.monitor.snapshot().active).toBe(true);

    fixture.monitor.stop();
    fixture.monitor.stop();
    expect(fixture.child.killCount).toBe(1);
    expect(fixture.monitor.snapshot()).toEqual({ supported: true, active: false });
    expect(vi.isMockFunction(fixture.spawn)).toBe(true);
  });
});
