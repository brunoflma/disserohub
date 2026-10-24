import { installBusy, type UpdateInstallStatus } from '../../../shared/update-install';

export { installBusy };

const INSTALL_URL = '/api/updates/install';
const HEALTH_URL = '/api/health';
const POLL_MS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 120_000;

export type UpdateInstallFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TimerHandle = unknown;

export interface UpdateInstallRequestOptions {
  requestTimeoutMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

function withRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  options: UpdateInstallRequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
  let timer: TimerHandle;
  let hasTimer = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimer(() => {
      controller.abort();
      reject(new Error('Update request timed out.'));
    }, timeoutMs);
    hasTimer = true;
  });
  return Promise.race([Promise.resolve().then(() => request(controller.signal)), timeout]).finally(() => {
    if (hasTimer) clearTimer(timer);
  });
}

export type UpdateInstallIssue =
  | 'status-unavailable'
  | 'install-unavailable'
  | 'version-changed'
  | 'health-check'
  | 'health-timeout';

export type UpdateInstallAction = 'started' | 'conflict' | 'failed' | 'unsupported' | 'busy' | 'refreshed';

export interface UpdateInstallControllerOptions {
  fetcher?: UpdateInstallFetch;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  currentVersion?: () => string | undefined;
  reload?: () => void;
  onChange?: () => void;
  now?: () => number;
  healthTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const PHASES = new Set<UpdateInstallStatus['phase']>([
  'idle', 'preparing', 'downloading', 'dependencies', 'building', 'restarting', 'done', 'error', 'rolled-back',
]);

function isStatus(value: unknown): value is UpdateInstallStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<UpdateInstallStatus>;
  return typeof status.supported === 'boolean' && typeof status.phase === 'string' && PHASES.has(status.phase as UpdateInstallStatus['phase']);
}

async function readJsonStatus(response: Response): Promise<UpdateInstallStatus> {
  if (!response.ok) throw new Error(`Install status request failed (${response.status}).`);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Install status response was not valid JSON.');
  }
  if (!isStatus(value)) throw new Error('Install status response had an invalid shape.');
  return value;
}

/** Reads the public status for the local installer. */
export async function fetchUpdateInstallStatus(
  fetcher: UpdateInstallFetch = fetch,
  options: UpdateInstallRequestOptions = {},
): Promise<UpdateInstallStatus> {
  return withRequestTimeout(
    signal => fetcher(INSTALL_URL, { headers: { Accept: 'application/json' }, signal }).then(readJsonStatus),
    options,
  );
}

/** Starts only the exact release the user saw; a conflict is never silently retargeted. */
export async function postUpdateInstall(
  version: string,
  fetcher: UpdateInstallFetch = fetch,
  options: UpdateInstallRequestOptions = {},
): Promise<UpdateInstallStatus> {
  if (!version) throw new TypeError('A release version is required.');
  return withRequestTimeout(async signal => {
    const response = await fetcher(INSTALL_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
      signal,
    });
    if (response.status === 409) throw new UpdateInstallConflictError(await responseError(response, 'A instalação não pôde ser iniciada.'));
    return readJsonStatus(response);
  }, options);
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  } catch {
    // The response may have no JSON body.
  }
  return fallback;
}

export class UpdateInstallConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateInstallConflictError';
  }
}

/**
 * Visible-page controller: polls only an active install, pauses while hidden, and
 * reloads only after the completed job and health endpoint agree on the target.
 */
export class UpdateInstallController {
  private readonly fetcher: UpdateInstallFetch;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly currentVersion: () => string | undefined;
  private readonly reload: () => void;
  private readonly onChange: () => void;
  private readonly now: () => number;
  private readonly healthTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private state: UpdateInstallStatus | undefined;
  private currentIssue: UpdateInstallIssue | undefined;
  private currentIssueMessage: string | undefined;
  private expectedVersion: string | undefined;
  private pageVersionAtStart: string | undefined;
  private active = false;
  private loading = false;
  private starting = false;
  private timer: TimerHandle | undefined;
  private hasTimer = false;
  private healthChecking = false;
  private healthStartedAt: number | undefined;
  private reloadSent = false;

  constructor(options: UpdateInstallControllerOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.currentVersion = options.currentVersion ?? (() => undefined);
    this.reload = options.reload ?? (() => globalThis.location.reload());
    this.onChange = options.onChange ?? (() => {});
    this.now = options.now ?? Date.now;
    this.healthTimeoutMs = options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get status(): UpdateInstallStatus | undefined {
    return this.state;
  }

  get issue(): UpdateInstallIssue | undefined {
    return this.currentIssue;
  }

  get issueMessage(): string | undefined {
    return this.currentIssueMessage;
  }

  get target(): string | undefined {
    return this.state?.target ?? this.expectedVersion;
  }

  get busy(): boolean {
    return this.starting || !!this.state && installBusy(this.state.phase);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.clearScheduled();
      if (this.state?.phase === 'done' && this.currentIssue === 'health-check') this.healthStartedAt = undefined;
      return;
    }
    if (this.state?.phase === 'done' && this.currentIssue === 'health-check') this.healthStartedAt = undefined;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.active || this.loading) return;
    this.loading = true;
    this.emit();
    try {
      const status = await fetchUpdateInstallStatus(this.fetcher, this.requestOptions());
      this.currentIssue = undefined;
      this.currentIssueMessage = undefined;
      this.receive(status);
    } catch {
      this.currentIssue = 'status-unavailable';
      this.currentIssueMessage = undefined;
      if (this.state && installBusy(this.state.phase)) this.scheduleStatusPoll();
      else if (this.state?.phase === 'done') this.scheduleHealthCheck();
    } finally {
      this.loading = false;
      this.emit();
    }
  }

  async install(version: string): Promise<UpdateInstallAction> {
    if (this.busy) return 'busy';
    if (this.state?.supported === false) return 'unsupported';
    this.expectedVersion = version;
    this.pageVersionAtStart = this.currentVersion();
    this.currentIssue = undefined;
    this.currentIssueMessage = undefined;
    this.starting = true;
    this.healthStartedAt = undefined;
    this.reloadSent = false;
    this.emit();
    try {
      const status = await postUpdateInstall(version, this.fetcher, this.requestOptions());
      this.receive(status);
      if (!status.supported) return 'unsupported';
      if (status.target && status.target !== version) {
        this.currentIssue = 'version-changed';
        this.emit();
        return 'conflict';
      }
      this.expectedVersion = status.target ?? version;
      return 'started';
    } catch (error) {
      if (error instanceof UpdateInstallConflictError) {
        this.currentIssue = 'version-changed';
        this.currentIssueMessage = error.message;
        return 'conflict';
      }
      this.currentIssue = 'install-unavailable';
      this.currentIssueMessage = undefined;
      return 'failed';
    } finally {
      this.starting = false;
      this.emit();
    }
  }

  async retry(version: string): Promise<UpdateInstallAction> {
    if (this.busy) return 'busy';
    if (this.state?.phase === 'done' && (this.currentIssue === 'health-check' || this.currentIssue === 'health-timeout')) {
      this.currentIssue = undefined;
      this.healthStartedAt = this.now();
      this.emit();
      await this.checkHealth();
      return 'refreshed';
    }
    if (this.currentIssue === 'status-unavailable' || this.currentIssue === 'version-changed') {
      this.currentIssue = undefined;
      this.currentIssueMessage = undefined;
      await this.refresh();
      return 'refreshed';
    }
    return this.install(version);
  }

  private receive(status: UpdateInstallStatus): void {
    this.state = status;
    if (status.target) this.expectedVersion = status.target;
    if (installBusy(status.phase)) {
      if (this.pageVersionAtStart === undefined) this.pageVersionAtStart = this.currentVersion();
      this.healthStartedAt = undefined;
      this.scheduleStatusPoll();
    } else if (status.phase === 'done') {
      if (this.pageVersionAtStart === undefined) this.pageVersionAtStart = this.currentVersion();
      this.clearScheduled();
      if (this.target && this.pageVersionAtStart !== this.target) void this.checkHealth();
    } else {
      this.clearScheduled();
      this.healthStartedAt = undefined;
    }
    this.emit();
  }

  private scheduleStatusPoll(): void {
    if (!this.active || !this.state || !installBusy(this.state.phase) || this.hasTimer) return;
    this.schedule(() => void this.refresh());
  }

  private scheduleHealthCheck(): void {
    if (!this.active || this.state?.phase !== 'done' || this.hasTimer) return;
    this.schedule(() => void this.checkHealth());
  }

  private schedule(callback: () => void): void {
    this.hasTimer = true;
    this.timer = this.setTimer(() => {
      this.hasTimer = false;
      this.timer = undefined;
      callback();
    }, POLL_MS);
  }

  private clearScheduled(): void {
    if (!this.hasTimer) return;
    this.clearTimer(this.timer);
    this.hasTimer = false;
    this.timer = undefined;
  }

  private async checkHealth(): Promise<void> {
    if (!this.active || this.healthChecking || this.state?.phase !== 'done' || !this.target) return;
    const target = this.target;
    if (this.pageVersionAtStart === target) {
      this.currentIssue = undefined;
      this.healthStartedAt = undefined;
      this.clearScheduled();
      this.emit();
      return;
    }
    if (this.healthStartedAt === undefined) this.healthStartedAt = this.now();
    this.healthChecking = true;
    try {
      const body = await withRequestTimeout(async signal => {
        const response = await this.fetcher(HEALTH_URL, { headers: { Accept: 'application/json' }, signal });
        return response.ok ? await response.json() as { version?: unknown } : undefined;
      }, this.requestOptions());
      if (body?.version === target) {
        this.currentIssue = undefined;
        this.healthStartedAt = undefined;
        this.clearScheduled();
        if (this.pageVersionAtStart !== target && !this.reloadSent) {
          this.reloadSent = true;
          this.reload();
        }
        return;
      }
      this.waitForHealth();
    } catch {
      this.waitForHealth();
    } finally {
      this.healthChecking = false;
      this.emit();
    }
  }

  private waitForHealth(): void {
    if (this.now() - (this.healthStartedAt ?? this.now()) >= this.healthTimeoutMs) {
      this.currentIssue = 'health-timeout';
      this.clearScheduled();
      return;
    }
    this.currentIssue = 'health-check';
    this.scheduleHealthCheck();
  }

  private requestOptions(): UpdateInstallRequestOptions {
    return {
      requestTimeoutMs: this.requestTimeoutMs,
      setTimer: this.setTimer,
      clearTimer: this.clearTimer,
    };
  }

  private emit(): void {
    this.onChange();
  }
}
