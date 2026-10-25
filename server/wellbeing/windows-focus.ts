import { spawn as nodeSpawn } from 'node:child_process';

export interface FocusSample {
  supported: boolean;
  active: boolean;
  idleMs?: number;
  sampledAt?: number;
}

interface FocusChild {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  kill(): unknown;
}

interface FocusSpawnOptions {
  shell: false;
  windowsHide: true;
  stdio: ['ignore', 'pipe', 'ignore'];
}

type FocusSpawn = (command: string, args: string[], options: FocusSpawnOptions) => FocusChild;

export interface WindowsFocusMonitorOptions {
  platform?: NodeJS.Platform;
  disabled?: boolean;
  spawn?: FocusSpawn;
  now?: () => number;
}

const SAMPLE_MAX_IDLE_MS = 0xffff_ffff;
const ACTIVE_IDLE_LIMIT_MS = 120_000;
const STALE_AFTER_MS = 15_000;
const MAX_JSON_LINE_LENGTH = 256;

const WINDOWS_FOCUS_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

public static class WellbeingWindowsFocusNative
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("kernel32.dll")]
    private static extern uint GetTickCount();

    public static string Sample()
    {
        try
        {
            LASTINPUTINFO lastInput = new LASTINPUTINFO();
            lastInput.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            if (!GetLastInputInfo(ref lastInput)) return InvalidSample();

            uint idleMs = unchecked(GetTickCount() - lastInput.dwTime);
            bool active = false;
            IntPtr foreground = GetForegroundWindow();
            if (foreground != IntPtr.Zero)
            {
                uint processId = 0;
                uint threadId = GetWindowThreadProcessId(foreground, out processId);
                if (threadId != 0 && processId != 0 && processId <= Int32.MaxValue)
                {
                    using (Process foregroundProcess = Process.GetProcessById((int)processId))
                    {
                        string name = foregroundProcess.ProcessName;
                        bool allowed =
                            String.Equals(name, "codex", StringComparison.OrdinalIgnoreCase) ||
                            String.Equals(name, "chatgpt", StringComparison.OrdinalIgnoreCase) ||
                            String.Equals(name, "claude", StringComparison.OrdinalIgnoreCase);
                        active = allowed && idleMs <= 120000;
                    }
                }
            }

            return "{\"active\":" + (active ? "true" : "false") +
                ",\"idleMs\":" + idleMs.ToString(CultureInfo.InvariantCulture) + "}";
        }
        catch
        {
            return InvalidSample();
        }
    }

    private static string InvalidSample()
    {
        return "{\"active\":false,\"idleMs\":-1}";
    }
}
'@
while ($true) {
  [Console]::Out.WriteLine([WellbeingWindowsFocusNative]::Sample())
  Start-Sleep -Milliseconds 5000
}
`;

interface ParsedFocusSample {
  active: boolean;
  idleMs: number;
}

function parseFocusLine(line: string): ParsedFocusSample | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes('active') || !keys.includes('idleMs')) return undefined;
  if (typeof record.active !== 'boolean') return undefined;
  if (typeof record.idleMs !== 'number' || !Number.isFinite(record.idleMs)) return undefined;
  if (!Number.isSafeInteger(record.idleMs) || record.idleMs < 0 || record.idleMs > SAMPLE_MAX_IDLE_MS) return undefined;

  return { active: record.active && record.idleMs <= ACTIVE_IDLE_LIMIT_MS, idleMs: record.idleMs };
}

export class WindowsFocusMonitor {
  private readonly platform: NodeJS.Platform;
  private readonly disabled: boolean;
  private readonly spawn: FocusSpawn;
  private readonly now: () => number;
  private started = false;
  private stopped = false;
  private failed = false;
  private child: FocusChild | undefined;
  private buffer = '';
  private latest: ParsedFocusSample | undefined;
  private sampledAt: number | undefined;

  constructor(options: WindowsFocusMonitorOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.disabled = options.disabled ?? false;
    this.spawn = options.spawn ?? (nodeSpawn as unknown as FocusSpawn);
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.platform !== 'win32' || this.disabled || this.started || this.stopped) return;
    this.started = true;

    try {
      const child = this.spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_FOCUS_HELPER],
        { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      this.child = child;
      if (!child.stdout) {
        this.fail();
        try { child.kill(); } catch { /* The helper is already unusable. */ }
        return;
      }

      child.stdout.on('data', this.onData);
      child.on('error', () => this.fail());
      child.on('close', () => this.fail());
    } catch {
      this.fail();
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.latest = undefined;
    this.sampledAt = undefined;
    this.buffer = '';
    const child = this.child;
    this.child = undefined;
    if (child) {
      try { child.kill(); } catch { /* Stop remains best-effort for the owned helper only. */ }
    }
  }

  snapshot(): FocusSample {
    const supported = this.platform === 'win32';
    if (!supported || this.disabled || !this.started || this.stopped || this.failed || !this.latest || this.sampledAt === undefined) {
      return { supported, active: false };
    }

    let currentTime: number;
    try {
      currentTime = this.now();
    } catch {
      return { supported: true, active: false };
    }
    const age = currentTime - this.sampledAt;
    if (!Number.isFinite(currentTime) || age < 0 || age >= STALE_AFTER_MS) return { supported: true, active: false };

    return {
      supported: true,
      active: this.latest.active,
      idleMs: this.latest.idleMs,
      sampledAt: this.sampledAt,
    };
  }

  private readonly onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this.buffer += text;

    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > MAX_JSON_LINE_LENGTH) this.invalidate();
      else this.acceptLine(line);
      newline = this.buffer.indexOf('\n');
    }

    if (this.buffer.length > MAX_JSON_LINE_LENGTH) {
      this.buffer = '';
      this.invalidate();
    }
  };

  private acceptLine(line: string): void {
    const sample = parseFocusLine(line);
    if (!sample) {
      this.invalidate();
      return;
    }

    let sampledAt: number;
    try {
      sampledAt = this.now();
    } catch {
      this.invalidate();
      return;
    }
    if (!Number.isFinite(sampledAt) || sampledAt < 0) {
      this.invalidate();
      return;
    }

    this.latest = sample;
    this.sampledAt = sampledAt;
  }

  private invalidate(): void {
    this.latest = undefined;
    this.sampledAt = undefined;
  }

  private fail(): void {
    this.failed = true;
    this.child = undefined;
    this.invalidate();
    this.buffer = '';
  }
}
