import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISSERO_REPOSITORY, UPSTREAM_BASE_VERSION, UPSTREAM_REPOSITORY } from '../../shared/distribution';
import { parseGithubRepo } from './checker';
import { assertReleaseTarget, assertSuccessfulCi } from '../../scripts/release';

describe('DisseroHub distribution boundary', () => {
  it('keeps package updates on the public visual repository and records the upstream baseline', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(parseGithubRepo(pkg.repository)).toBe(DISSERO_REPOSITORY);
    expect(pkg.disserohub).toEqual({ upstreamRepository: UPSTREAM_REPOSITORY, upstreamVersion: UPSTREAM_BASE_VERSION });
  });

  it('refuses to publish to the upstream, including when gh defaults there for a fork', () => {
    expect(() => assertReleaseTarget(`https://github.com/${DISSERO_REPOSITORY}.git`, `https://github.com/${UPSTREAM_REPOSITORY}.git`)).toThrow();
    expect(() => assertReleaseTarget(`https://github.com/${UPSTREAM_REPOSITORY}.git`, `https://github.com/${DISSERO_REPOSITORY}.git`)).toThrow();
    expect(() => assertReleaseTarget({ url: `git+https://github.com/${DISSERO_REPOSITORY}.git` }, `git@github.com:${DISSERO_REPOSITORY}.git`)).not.toThrow();
  });

  it('requires a successful CI run for the exact release commit', () => {
    const run = { id: 1, name: 'CI', head_sha: 'release', status: 'completed', conclusion: 'success' };
    expect(() => assertSuccessfulCi([run], 'release')).not.toThrow();
    expect(() => assertSuccessfulCi([run], 'different')).toThrow();
    expect(() => assertSuccessfulCi([{ ...run, status: 'in_progress', conclusion: null }], 'release')).toThrow();
    expect(() => assertSuccessfulCi([run, { ...run, id: 2, conclusion: 'failure' }], 'release')).toThrow();
  });
});
