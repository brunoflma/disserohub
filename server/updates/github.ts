import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DISSERO_REPOSITORY } from '../../shared/distribution';

const endpoint = `https://api.github.com/repos/${DISSERO_REPOSITORY}/releases/latest`;
const exec = promisify(execFile);

async function readWithLocalGithubCli(): Promise<string> {
  const executable = process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe') : 'gh';
  const { stdout } = await exec(executable, ['api', `repos/${DISSERO_REPOSITORY}/releases/latest`, '--hostname', 'github.com'], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  return stdout;
}

/** Use an existing local gh session only when this public repository's anonymous quota is exhausted. */
export function createGithubReleaseFetch(network: typeof fetch = fetch, cli: () => Promise<string> = readWithLocalGithubCli): typeof fetch {
  return async (input, init) => {
    const response = await network(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const limited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    if (url !== endpoint || !limited) return response;
    try {
      const body = await cli();
      JSON.parse(body);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch {
      // gh is optional. Keep the original quota response; never log CLI credentials or stderr.
      return response;
    }
  };
}
