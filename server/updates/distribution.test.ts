import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISSERO_REPOSITORY, distributionVersion, UPSTREAM_BASE_VERSION, UPSTREAM_REFERENCE_VERSION, UPSTREAM_REPOSITORY } from '../../shared/distribution';
import { parseGithubRepo } from './checker';
import { assertReleaseTarget, assertSuccessfulCi, assertVersionAlignment } from '../../scripts/release';

describe('DisseroHub distribution boundary', () => {
  it('keeps package updates on the public visual repository and records the upstream baseline', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(parseGithubRepo(pkg.repository)).toBe(DISSERO_REPOSITORY);
    expect(pkg.disserohub).toMatchObject({ upstreamRepository: UPSTREAM_REPOSITORY, upstreamVersion: UPSTREAM_BASE_VERSION, upstreamReferenceVersion: UPSTREAM_REFERENCE_VERSION });
    expect(() => assertVersionAlignment(pkg)).not.toThrow();
  });

  it('refuses a distribution number that does not match the reviewed official reference', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(() => assertVersionAlignment({ ...pkg, version: '0.11.4' })).toThrow();
    expect(() => assertVersionAlignment({ ...pkg, version: `${UPSTREAM_REFERENCE_VERSION}.1` })).toThrow();
    expect(() => assertVersionAlignment({ ...pkg, disserohub: { ...pkg.disserohub, upstreamReferenceVersion: '0.0.0' } })).toThrow();
  });

  it('refuses to relabel the actual engine baseline as the reviewed reference', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(() => assertVersionAlignment({ ...pkg, disserohub: { ...pkg.disserohub, upstreamVersion: '99.0.0' } })).toThrow();
    expect(() => assertVersionAlignment({ ...pkg, disserohub: { ...pkg.disserohub, upstreamRepository: 'someone/else' } })).toThrow();
  });

  it('publishes fourth-component revisions without changing the reviewed upstream number', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(distributionVersion({ ...pkg, disserohub: { ...pkg.disserohub, revision: 1 } })).toBe(`${UPSTREAM_REFERENCE_VERSION}.1`);
    expect(distributionVersion({ ...pkg, disserohub: { ...pkg.disserohub, revision: 12 } })).toBe(`${UPSTREAM_REFERENCE_VERSION}.12`);
    expect(distributionVersion({ ...pkg, disserohub: { ...pkg.disserohub, revision: 0 } })).toBe(UPSTREAM_REFERENCE_VERSION);
    for (const revision of [-1, 1.5, '1', null, 1_000_000]) {
      expect(() => assertVersionAlignment({ ...pkg, disserohub: { ...pkg.disserohub, revision } })).toThrow();
    }
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
