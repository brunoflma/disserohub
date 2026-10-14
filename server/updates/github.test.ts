import { describe, expect, it, vi } from 'vitest';
import { DISSERO_REPOSITORY } from '../../shared/distribution';
import { createGithubReleaseFetch } from './github';

const endpoint = `https://api.github.com/repos/${DISSERO_REPOSITORY}/releases/latest`;

describe('local GitHub CLI release fallback', () => {
  it('recovers exhausted anonymous quota without putting credentials in the fetch request', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
    const cli = vi.fn().mockResolvedValue(JSON.stringify({ tag_name: 'v0.11.2', html_url: `https://github.com/${DISSERO_REPOSITORY}/releases/tag/v0.11.2` }));
    const result = await createGithubReleaseFetch(network, cli)(endpoint);
    expect(result.status).toBe(200);
    expect((await result.json()).tag_name).toBe('v0.11.2');
    expect(network).toHaveBeenCalledWith(endpoint, undefined);
    expect(cli).toHaveBeenCalledTimes(1);
  });

  it('does not invoke authenticated CLI for other repositories or ordinary permission failures', async () => {
    const cli = vi.fn();
    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    await createGithubReleaseFetch(limited, cli)('https://api.github.com/repos/marmottajr/habblaud/releases/latest');
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));
    await createGithubReleaseFetch(denied, cli)(endpoint);
    expect(cli).not.toHaveBeenCalled();
  });

  it('keeps a successful anonymous response and tolerates a missing or unauthenticated CLI', async () => {
    const original = new Response('{}');
    const cli = vi.fn();
    expect(await createGithubReleaseFetch(vi.fn<typeof fetch>().mockResolvedValue(original), cli)(endpoint)).toBe(original);
    expect(cli).not.toHaveBeenCalled();
    const quota = new Response('', { status: 429 });
    const unavailable = vi.fn().mockRejectedValue(new Error('CLI unavailable'));
    expect(await createGithubReleaseFetch(vi.fn<typeof fetch>().mockResolvedValue(quota), unavailable)(endpoint)).toBe(quota);
  });
});
