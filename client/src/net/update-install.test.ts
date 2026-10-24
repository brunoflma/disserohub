import { describe, expect, it, vi } from 'vitest';
import type { UpdateInstallStatus } from '../../../shared/update-install';
import {
  fetchUpdateInstallStatus,
  postUpdateInstall,
  UpdateInstallConflictError,
  UpdateInstallController,
  type UpdateInstallFetch,
} from './update-install';

function status(phase: UpdateInstallStatus['phase'], patch: Partial<UpdateInstallStatus> = {}): UpdateInstallStatus {
  return { supported: true, phase, ...patch };
}

function json(value: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(value), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
}

function waitForAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error('Request did not receive an abort signal.'));
      return;
    }
    const abort = () => reject(new DOMException('Request aborted.', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function timers() {
  let sequence = 0;
  const tasks = new Map<number, { callback: () => void; delay: number }>();
  return {
    set(callback: () => void, delay: number): number {
      const id = ++sequence;
      tasks.set(id, { callback, delay });
      return id;
    },
    clear(handle: unknown): void {
      tasks.delete(handle as number);
    },
    get size(): number {
      return tasks.size;
    },
    get delays(): number[] {
      return [...tasks.values()].map(task => task.delay);
    },
    async runNext(): Promise<void> {
      const next = tasks.entries().next().value as [number, { callback: () => void; delay: number }] | undefined;
      if (!next) throw new Error('No timer is scheduled.');
      tasks.delete(next[0]);
      next[1].callback();
      await settle();
    },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
}

describe('update install HTTP client', () => {
  it('reads status and posts the exact displayed version to the same-origin endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: UpdateInstallFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return json(status('idle'));
    };

    await fetchUpdateInstallStatus(fetcher);
    await postUpdateInstall('1.2.3', fetcher);

    expect(calls[0]).toMatchObject({ url: '/api/updates/install', init: { headers: { Accept: 'application/json' } } });
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1].url).toBe('/api/updates/install');
    expect(calls[1].init).toMatchObject({
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '1.2.3' }),
    });
    expect(calls[1].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a version conflict without reading or choosing another release', async () => {
    const fetcher: UpdateInstallFetch = async () => json({ error: 'Há terminais abertos.' }, 409);
    await expect(postUpdateInstall('1.2.3', fetcher)).rejects.toMatchObject({
      name: 'UpdateInstallConflictError',
      message: 'Há terminais abertos.',
    });
  });

  it('rejects malformed status responses', async () => {
    const fetcher: UpdateInstallFetch = async () => json({ supported: true, phase: 'installing' });
    await expect(fetchUpdateInstallStatus(fetcher)).rejects.toThrow('invalid shape');
  });
});

describe('UpdateInstallController', () => {
  it('aborts a status request that never returns and releases the loading state', async () => {
    const timer = timers();
    let requestSignal: AbortSignal | null | undefined;
    const fetcher: UpdateInstallFetch = (_input, init) => {
      requestSignal = init?.signal;
      return waitForAbort(requestSignal);
    };
    const controller = new UpdateInstallController({ fetcher, setTimer: timer.set, clearTimer: timer.clear });

    controller.setActive(true);
    await settle();
    expect(controller.busy).toBe(false);
    expect(timer.delays).toEqual([15_000]);

    await timer.runNext();
    expect(requestSignal?.aborted).toBe(true);
    expect(controller.issue).toBe('status-unavailable');
    expect(timer.size).toBe(0);
  });

  it('aborts a POST that never returns so the installer can be retried', async () => {
    const timer = timers();
    let postSignal: AbortSignal | null | undefined;
    const fetcher: UpdateInstallFetch = (input, init) => {
      if (String(input) === '/api/updates/install' && init?.method === 'POST') {
        postSignal = init.signal;
        return waitForAbort(postSignal);
      }
      return Promise.resolve(json(status('idle')));
    };
    const controller = new UpdateInstallController({ fetcher, setTimer: timer.set, clearTimer: timer.clear, requestTimeoutMs: 15 });
    controller.setActive(true);
    await settle();

    const starting = controller.install('2.0.0');
    await settle();
    expect(controller.busy).toBe(true);
    expect(timer.delays).toEqual([15]);

    await timer.runNext();
    expect(await starting).toBe('failed');
    expect(postSignal?.aborted).toBe(true);
    expect(controller.busy).toBe(false);
    expect(controller.issue).toBe('install-unavailable');
    expect(timer.size).toBe(0);
  });

  it('aborts a health request that never returns and resumes bounded health checks', async () => {
    const timer = timers();
    let healthSignal: AbortSignal | null | undefined;
    const fetcher: UpdateInstallFetch = (input, init) => {
      if (String(input) === '/api/health') {
        healthSignal = init?.signal;
        return waitForAbort(healthSignal);
      }
      return Promise.resolve(json(status('done', { target: '2.0.0' })));
    };
    const controller = new UpdateInstallController({
      fetcher,
      setTimer: timer.set,
      clearTimer: timer.clear,
      requestTimeoutMs: 15,
      currentVersion: () => '1.0.0',
    });
    controller.setActive(true);
    await settle();
    expect(timer.delays).toEqual([15]);

    await timer.runNext();
    expect(healthSignal?.aborted).toBe(true);
    expect(controller.issue).toBe('health-check');
    expect(timer.delays).toEqual([1000]);
    controller.setActive(false);
    expect(timer.size).toBe(0);
  });

  it('pauses polling while hidden and refreshes status when shown again', async () => {
    const timer = timers();
    const fetcher = vi.fn<UpdateInstallFetch>()
      .mockResolvedValueOnce(json(status('preparing', { target: '2.0.0' })))
      .mockResolvedValueOnce(json(status('idle')));
    const controller = new UpdateInstallController({ fetcher, setTimer: timer.set, clearTimer: timer.clear });

    controller.setActive(true);
    await settle();
    expect(controller.busy).toBe(true);
    expect(timer.delays).toEqual([1000]);

    controller.setActive(false);
    expect(timer.size).toBe(0);
    controller.setActive(true);
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controller.status?.phase).toBe('idle');
    expect(timer.size).toBe(0);
  });

  it('retries temporary status failures and reloads once only after health reports the target', async () => {
    const timer = timers();
    const reload = vi.fn();
    const queue: Array<Response | Error> = [
      json(status('preparing', { target: '2.0.0' })),
      new TypeError('server restarting'),
      json(status('done', { target: '2.0.0' })),
      json({ version: '2.0.0' }),
      json(status('done', { target: '2.0.0' })),
      json({ version: '2.0.0' }),
    ];
    const fetcher: UpdateInstallFetch = async () => {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('Unexpected request.');
      return next;
    };
    const controller = new UpdateInstallController({
      fetcher,
      setTimer: timer.set,
      clearTimer: timer.clear,
      currentVersion: () => '1.0.0',
      reload,
    });

    controller.setActive(true);
    await settle();
    await timer.runNext();
    expect(controller.issue).toBe('status-unavailable');
    expect(controller.busy).toBe(true);
    await timer.runNext();
    expect(reload).toHaveBeenCalledTimes(1);

    await controller.refresh();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(timer.size).toBe(0);
  });

  it('does not silently retarget a 409 and lets the next explicit retry refresh only', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetcher: UpdateInstallFetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (method === 'POST') return json({ error: 'Já existe uma instalação em andamento.' }, 409);
      return json(status('idle'));
    };
    const controller = new UpdateInstallController({ fetcher });
    controller.setActive(true);
    await settle();

    expect(await controller.install('2.0.0')).toBe('conflict');
    expect(controller.issue).toBe('version-changed');
    expect(controller.issueMessage).toBe('Já existe uma instalação em andamento.');
    expect(controller.target).toBe('2.0.0');
    expect(await controller.retry('2.1.0')).toBe('refreshed');

    expect(calls.map(call => call.method)).toEqual(['GET', 'POST', 'GET']);
  });

  it('shows unsupported status and does not send a POST', async () => {
    const fetcher = vi.fn<UpdateInstallFetch>().mockResolvedValue(json(status('idle', { supported: false, reason: 'remote_install_unsupported' })));
    const controller = new UpdateInstallController({ fetcher });
    controller.setActive(true);
    await settle();

    expect(controller.status?.supported).toBe(false);
    expect(await controller.install('2.0.0')).toBe('unsupported');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('allows retry after rollback and observes the next real stage', async () => {
    const fetcher = vi.fn<UpdateInstallFetch>()
      .mockResolvedValueOnce(json(status('idle')))
      .mockResolvedValueOnce(json(status('rolled-back', { target: '2.0.0', message: 'A versão anterior voltou.' })))
      .mockResolvedValueOnce(json(status('preparing', { target: '2.0.0' })));
    const controller = new UpdateInstallController({ fetcher });
    controller.setActive(true);
    await settle();

    expect(await controller.install('2.0.0')).toBe('started');
    expect(controller.status?.phase).toBe('rolled-back');
    expect(controller.busy).toBe(false);
    expect(await controller.retry('2.0.0')).toBe('started');
    expect(controller.status?.phase).toBe('preparing');
    expect(controller.busy).toBe(true);
  });

  it('retries a terminal install error with a new explicit POST', async () => {
    const timer = timers();
    const fetcher = vi.fn<UpdateInstallFetch>()
      .mockResolvedValueOnce(json(status('idle')))
      .mockResolvedValueOnce(json(status('error', { target: '2.0.0', message: 'Build failed.' })))
      .mockResolvedValueOnce(json(status('preparing', { target: '2.0.0' })));
    const controller = new UpdateInstallController({ fetcher, setTimer: timer.set, clearTimer: timer.clear });
    controller.setActive(true);
    await settle();

    expect(await controller.install('2.0.0')).toBe('started');
    expect(controller.status?.phase).toBe('error');
    expect(controller.busy).toBe(false);
    expect(await controller.retry('2.0.0')).toBe('started');
    expect(controller.status?.phase).toBe('preparing');
    expect(controller.busy).toBe(true);
    expect(timer.delays).toEqual([1000]);
  });
});
