import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DISSERO_REPOSITORY, distributionVersion, UPSTREAM_BASE_VERSION, UPSTREAM_REFERENCE_VERSION, UPSTREAM_REPOSITORY } from '../../shared/distribution';
import { parseGithubRepo } from './checker';
import { assertReleaseTarget, assertSuccessfulCi, assertVersionAlignment, parseReleaseArgs, remoteMainSha } from '../../scripts/release';
import { checkCircleCi, CI_POLICY, latestMainRun, type CiEvidence, type CiQuery } from '../../scripts/release-ci';

const SHA = 'e'.repeat(40);
const RUN = '11111111-1111-4111-8111-111111111111';
const WORKFLOW = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';

function evidence(): CiEvidence {
  const source = readFileSync(new URL('../../.circleci/config.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bytes = Buffer.from(source);
  const vcs = { provider: 'github_app', repo_id: CI_POLICY.repositoryId, repo_full_name: DISSERO_REPOSITORY };
  return {
    project: { data: { id: CI_POLICY.projectId, references: { org: { id: CI_POLICY.organizationId } } } },
    definition: { data: { id: CI_POLICY.definitionId, references: { project: { id: CI_POLICY.projectId } }, attributes: {
      config: { type: 'vcs', file_path: CI_POLICY.configPath, file_type: 'circleci', vcs }, checkout: { type: 'vcs', vcs },
    } } },
    run: { data: { id: RUN, attributes: { number: 4, phase: 'ended', current_outcome: 'succeeded' }, references: {
      project: { id: CI_POLICY.projectId }, pipeline: { id: CI_POLICY.definitionId },
      event: { attributes: { type: 'push', action: 'push', vcs: { branch: 'main', revision: SHA,
        origin_repository_url: `https://github.com/${DISSERO_REPOSITORY}`, target_repository_url: `https://github.com/${DISSERO_REPOSITORY}` } } },
    } } },
    pipeline: { id: RUN, number: 4, project_slug: CI_POLICY.projectSlug, errors: [], trigger_parameters: {
      circleci: { event_type: 'push', trigger_type: 'github_app' },
      github_app: { ...vcs, branch: 'main', full_ref: 'refs/heads/main', ref: 'main', checkout_sha: SHA, commit_sha: SHA, repo_url: `https://github.com/${DISSERO_REPOSITORY}` },
      git: { branch: 'main', ref: 'refs/heads/main', checkout_sha: SHA, repo_url: `https://github.com/${DISSERO_REPOSITORY}` },
    } },
    configuration: { source, setup_config: '', compiled_setup_config: '' },
    mainConfig: { type: 'file', path: CI_POLICY.configPath, encoding: 'base64', content: bytes.toString('base64'),
      size: bytes.length, sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') },
    workflows: [{ id: WORKFLOW, name: CI_POLICY.workflow, pipeline_id: RUN, project_slug: CI_POLICY.projectSlug,
      status: 'success', created_at: '2026-11-16T18:34:53.988Z', stopped_at: '2026-11-16T18:35:54.749Z' }],
    jobs: [{ id: JOB, name: CI_POLICY.job, type: 'build', status: 'success', job_number: 4,
      started_at: '2026-11-16T18:34:56.247Z', stopped_at: '2026-11-16T18:35:54.749Z' }],
    job: { name: CI_POLICY.job, number: 4, status: 'success', project: { id: CI_POLICY.projectId, slug: CI_POLICY.projectSlug },
      organization: { name: CI_POLICY.organizationId }, pipeline: { id: RUN }, latest_workflow: { id: WORKFLOW } },
  };
}

function provider(e: CiEvidence, changed?: 'run' | 'workflow' | 'job'): CiQuery {
  let listReads = 0;
  let workflowReads = 0;
  let jobReads = 0;
  return vi.fn((tool, args) => {
    expect(args.slice(-2)).toEqual(['--method', 'GET']);
    const path = args[1];
    if (tool === 'gh') {
      expect(path).toContain(`repos/${DISSERO_REPOSITORY}/contents/${CI_POLICY.configPath}?ref=${SHA}`);
      return JSON.stringify(e.mainConfig);
    }
    expect(tool).toBe('circleci');
    if (path.startsWith('api/v3/runs?')) {
      listReads++;
      const run = structuredClone(e.run.data);
      if (changed === 'run' && listReads > 1) { run.id = '44444444-4444-4444-8444-444444444444'; run.attributes.number++; }
      return JSON.stringify({ data: [run] });
    }
    if (path === `api/v3/runs/${RUN}`) return JSON.stringify(e.run);
    if (path === `api/v3/projects/${CI_POLICY.projectId}`) return JSON.stringify(e.project);
    if (path === `api/v3/pipelines/${CI_POLICY.definitionId}`) return JSON.stringify(e.definition);
    if (path === `api/v2/pipeline/${RUN}`) return JSON.stringify(e.pipeline);
    if (path === `api/v2/pipeline/${RUN}/config`) return JSON.stringify(e.configuration);
    if (path === `api/v2/pipeline/${RUN}/workflow`) {
      workflowReads++;
      const items = structuredClone(e.workflows);
      if (changed === 'workflow' && workflowReads > 1) items.push({ ...items[0], id: '44444444-4444-4444-8444-444444444444', created_at: '2026-11-16T19:00:00Z', status: 'running' });
      return JSON.stringify({ items, next_page_token: null });
    }
    if (path === `api/v2/workflow/${WORKFLOW}/job`) {
      jobReads++;
      const items = structuredClone(e.jobs);
      if (changed === 'job' && jobReads > 1) items[0].status = 'not_run';
      return JSON.stringify({ items, next_page_token: null });
    }
    if (path === `api/v2/project/${CI_POLICY.projectSlug}/job/4`) return JSON.stringify(e.job);
    throw new Error(`Unexpected read-only endpoint: ${path}`);
  });
}

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

  it('requires actual CircleCI run/workflow/job proof for the exact full main SHA', () => {
    expect(assertSuccessfulCi(evidence(), SHA)).toMatchObject({ provider: 'circleci', sha: SHA, runId: RUN, workflowId: WORKFLOW, jobId: JOB });
    for (const sha of [SHA.slice(0, 7), 'different', 'f'.repeat(40)]) expect(() => assertSuccessfulCi(evidence(), sha)).toThrow();
  });
});

describe('CircleCI release eligibility', () => {
  it('keeps check-ci read-only and distinct from dry-run', () => {
    expect(parseReleaseArgs(['--check-ci'])).toEqual({ dryRun: false, help: false, checkCi: true });
    expect(() => parseReleaseArgs(['--check-ci', '--dry-run'])).toThrow();
    expect(remoteMainSha(`${SHA}\trefs/heads/main\n`)).toBe(SHA);
    for (const text of [`${SHA.slice(0, 7)}\trefs/heads/main`, `${SHA}\trefs/heads/feature`, `${SHA}\trefs/heads/main\n${SHA}\trefs/heads/main`]) {
      expect(() => remoteMainSha(text)).toThrow();
    }
  });

  it('uses latest main first; pending/failure cannot reveal an older green', () => {
    for (const outcome of ['failed', 'running', null]) {
      const e = evidence();
      const older = structuredClone(e.run.data);
      older.attributes.number = 3;
      e.run.data.attributes.current_outcome = outcome;
      expect(latestMainRun([older, e.run.data])).toBe(e.run.data);
      expect(() => assertSuccessfulCi(e, SHA)).toThrow();
      expect(() => checkCircleCi(SHA, provider(e))).toThrow();
    }
  });

  it.each([
    ['project', (e: CiEvidence) => { e.project.data.id = 'other'; }],
    ['organization', (e: CiEvidence) => { e.project.data.references.org.id = 'other'; }],
    ['definition', (e: CiEvidence) => { e.definition.data.id = 'other'; }],
    ['config repo', (e: CiEvidence) => { e.definition.data.attributes.config.vcs.repo_id = 'other'; }],
    ['checkout repo', (e: CiEvidence) => { e.definition.data.attributes.checkout.vcs.repo_full_name = 'other/repo'; }],
    ['PR at same SHA', (e: CiEvidence) => { e.run.data.references.event.attributes.type = 'pull_request'; }],
    ['API at same SHA', (e: CiEvidence) => { e.run.data.references.event.attributes.type = 'api'; }],
    ['branch', (e: CiEvidence) => { e.run.data.references.event.attributes.vcs.branch = 'feature'; }],
    ['fork', (e: CiEvidence) => { e.run.data.references.event.attributes.vcs.origin_repository_url = 'https://github.com/other/repo'; }],
    ['checkout SHA', (e: CiEvidence) => { e.pipeline.trigger_parameters.github_app.checkout_sha = SHA.slice(0, 7); }],
    ['config ref', (e: CiEvidence) => { e.run.data.attributes.config = { ref: 'feature' }; }],
    ['definition ref', (e: CiEvidence) => { e.definition.data.attributes.config.ref = 'feature'; }],
    ['config revision', (e: CiEvidence) => { e.run.data.attributes.config = { revision: 'a'.repeat(40) }; }],
    ['trigger config ref', (e: CiEvidence) => { e.pipeline.trigger_parameters.git.config_ref = 'feature'; }],
    ['workflow omitted', (e: CiEvidence) => { e.workflows = []; }],
    ['job omitted', (e: CiEvidence) => { e.jobs = []; }],
    ['job skipped', (e: CiEvidence) => { e.jobs[0].status = 'not_run'; }],
    ['approval instead of build', (e: CiEvidence) => { e.jobs[0].type = 'approval'; }],
    ['job pipeline', (e: CiEvidence) => { e.job.pipeline.id = 'other'; }],
    ['source', (e: CiEvidence) => { e.configuration.source += '\n'; }],
    ['main blob', (e: CiEvidence) => { e.mainConfig.sha = 'a'.repeat(40); }],
    ['dynamic setup', (e: CiEvidence) => { e.configuration.setup_config = 'setup: true'; }],
  ])('rejects %s evidence', (_name, change) => {
    const e = evidence();
    change(e);
    expect(() => assertSuccessfulCi(e, SHA)).toThrow();
  });

  it('rejects newer pending/failing workflow reruns instead of accepting the old success', () => {
    for (const status of ['running', 'failed', 'canceled', 'not_run']) {
      const e = evidence();
      e.workflows.push({ ...e.workflows[0], id: '44444444-4444-4444-8444-444444444444', status, created_at: '2026-11-16T19:00:00Z', stopped_at: '2026-11-16T19:01:00Z' });
      expect(() => assertSuccessfulCi(e, SHA)).toThrow();
    }
  });

  it('requires review when both executed and main config omit an approved verify command', () => {
    const e = evidence();
    const source = e.configuration.source.replace('npm test -- --maxWorkers=2', 'echo tests omitted');
    const bytes = Buffer.from(source);
    e.configuration.source = source;
    e.mainConfig.content = bytes.toString('base64');
    e.mainConfig.size = bytes.length;
    e.mainConfig.sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(() => assertSuccessfulCi(e, SHA)).toThrow(/fingerprint/);
  });

  it('loads real API shapes with explicit GET and rechecks races before returning proof', () => {
    const query = provider(evidence());
    expect(checkCircleCi(SHA, query)).toMatchObject({ sha: SHA, configSha256: CI_POLICY.configSha256 });
    for (const changed of ['run', 'workflow', 'job'] as const) expect(() => checkCircleCi(SHA, provider(evidence(), changed))).toThrow();
  });

  it('accepts the deployed v2 terminal-page schema without a next_page_token property', () => {
    const base = provider(evidence());
    const query: CiQuery = (tool, args) => {
      const body = JSON.parse(base(tool, args));
      if (Array.isArray(body.items)) delete body.next_page_token;
      return JSON.stringify(body);
    };
    expect(checkCircleCi(SHA, query)).toMatchObject({ runId: RUN, jobId: JOB });
  });

  it('does not infer success from provider errors, malformed JSON or incomplete pagination', () => {
    expect(() => checkCircleCi(SHA, () => { throw new Error('read denied'); })).toThrow('read denied');
    expect(() => checkCircleCi(SHA, () => 'invalid JSON')).toThrow();
    const runs = Array.from({ length: 10 }, (_, i) => {
      const run = evidence().run.data;
      run.attributes.number = 10 - i;
      run.references.event.attributes.vcs.branch = 'feature';
      return run;
    });
    expect(() => checkCircleCi(SHA, () => JSON.stringify({ data: runs }))).toThrow(/paginação/);
  });
});
