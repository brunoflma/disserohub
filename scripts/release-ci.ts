import { createHash } from 'node:crypto';
import { DISSERO_REPOSITORY } from '../shared/distribution';

export const CI_POLICY = {
  projectId: '00f1e232-fe64-455d-a441-42f4619ffb4f',
  organizationId: 'f85f07d9-7ed4-4135-a871-b1bcee70304a',
  definitionId: '34c71e1f-260c-4f59-ae03-a8377d27eaeb',
  repositoryId: '1419434722',
  projectSlug: 'circleci/XfrfcZpPtgpA9A6Boq3UsT/17mVhvRWTnQtL5SErAnePg',
  workflow: 'verify_main_and_pull_requests',
  job: 'verify',
  configPath: '.circleci/config.yml',
  // Reviewed native verify contract: install, typecheck, onboarding, tests and build.
  configSha256: '2f717f3ac553ab7c51ea4aae5db7fb54cafbdd291fb09acf08b0a768d9d8f68e',
} as const;

type Obj = Record<string, any>;
export type CiQuery = (tool: 'circleci' | 'gh', args: string[]) => string;
export interface CiEvidence {
  project: Obj;
  definition: Obj;
  run: Obj;
  pipeline: Obj;
  configuration: Obj;
  mainConfig: Obj;
  workflows: Obj[];
  jobs: Obj[];
  job: Obj;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function requireCi(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(`CI CircleCI recusada: ${reason}`);
}
function fullSha(sha: string): void {
  requireCi(/^[a-f0-9]{40}$/.test(sha), 'o SHA precisa ter 40 caracteres hexadecimais.');
}
function repositoryUrl(url: unknown): boolean {
  return typeof url === 'string'
    && (url === `https://github.com/${DISSERO_REPOSITORY}` || url === `https://github.com/${DISSERO_REPOSITORY}.git`);
}
function timestamp(value: unknown): number {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  requireCi(Number.isFinite(time), 'timestamp ausente ou inválido.');
  return time;
}
function declaredRefs(value: Obj | undefined, sha: string): void {
  if (!value) return;
  for (const ref of [value.ref, value.branch]) {
    if (ref !== undefined) requireCi(ref === 'main' || ref === 'refs/heads/main' || ref === sha, 'config/checkout ref divergente.');
  }
  if (value.revision !== undefined) requireCi(value.revision === sha, 'config/checkout revision divergente.');
}

/** Select before checking success: a pending/failing latest run must not expose an older green. */
export function latestMainRun(runs: Obj[]): Obj {
  const candidates = runs.filter((run) => run.references?.pipeline?.id === CI_POLICY.definitionId
    && run.references?.event?.attributes?.vcs?.branch === 'main');
  requireCi(candidates.length, 'nenhum run da definição de main foi encontrado.');
  for (const run of candidates) {
    requireCi(UUID.test(run.id) && Number.isSafeInteger(run.attributes?.number) && run.attributes.number > 0, 'identidade/número do run inválido.');
  }
  candidates.sort((a, b) => b.attributes.number - a.attributes.number);
  requireCi(candidates.length === 1 || candidates[0].attributes.number !== candidates[1].attributes.number, 'runs ambíguos.');
  return candidates[0];
}

function latestWorkflow(workflows: Obj[], runId: string): Obj {
  const matches = workflows.filter((workflow) => workflow.name === CI_POLICY.workflow);
  requireCi(matches.length, 'workflow obrigatório omitido.');
  for (const workflow of matches) {
    requireCi(UUID.test(workflow.id) && workflow.pipeline_id === runId && workflow.project_slug === CI_POLICY.projectSlug,
      'workflow de outro pipeline/projeto.');
    timestamp(workflow.created_at);
  }
  matches.sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
  requireCi(matches.length === 1 || timestamp(matches[0].created_at) !== timestamp(matches[1].created_at), 'tentativas de workflow ambíguas.');
  return matches[0];
}

/** Actual v3 run + v2 workflow/job/config schemas; no GitHub aggregate-check inference. */
export function assertSuccessfulCi(e: CiEvidence, sha: string) {
  fullSha(sha);
  const project = e.project.data;
  requireCi(project?.id === CI_POLICY.projectId && project.references?.org?.id === CI_POLICY.organizationId, 'projeto/organização divergente.');
  const definition = e.definition.data;
  requireCi(definition?.id === CI_POLICY.definitionId && definition.references?.project?.id === CI_POLICY.projectId, 'definição divergente.');
  for (const source of [definition.attributes?.config, definition.attributes?.checkout]) {
    requireCi(source?.type === 'vcs' && source.vcs?.provider === 'github_app'
      && source.vcs.repo_id === CI_POLICY.repositoryId && source.vcs.repo_full_name === DISSERO_REPOSITORY, 'fonte config/checkout de outro repositório.');
    declaredRefs(source, sha);
  }
  requireCi(definition.attributes.config.file_path === CI_POLICY.configPath
    && definition.attributes.config.file_type === 'circleci', 'caminho/tipo da configuração divergente.');
  const run = e.run.data;
  requireCi(run && UUID.test(run.id) && run.references?.project?.id === CI_POLICY.projectId
    && run.references?.pipeline?.id === CI_POLICY.definitionId, 'run de outro projeto/definição.');
  const event = run.references?.event?.attributes;
  const vcs = event?.vcs;
  requireCi(event?.type === 'push' && event.action === 'push' && vcs?.branch === 'main'
    && vcs.revision === sha && repositoryUrl(vcs.origin_repository_url) && repositoryUrl(vcs.target_repository_url),
  'exige push de main no SHA completo do repositório correto; PR/API não substitui main.');
  declaredRefs(run.attributes?.config, sha);
  declaredRefs(run.attributes?.checkout, sha);
  requireCi(run.attributes?.phase === 'ended' && run.attributes.current_outcome === 'succeeded', 'o run mais recente ainda não terminou com sucesso.');
  const pipeline = e.pipeline;
  requireCi(pipeline.id === run.id && pipeline.project_slug === CI_POLICY.projectSlug
    && pipeline.number === run.attributes.number && Array.isArray(pipeline.errors) && pipeline.errors.length === 0, 'pipeline incompatível ou com erro.');
  const parameters = pipeline.trigger_parameters;
  const app = parameters?.github_app;
  const git = parameters?.git;
  requireCi(parameters?.circleci?.event_type === 'push' && parameters.circleci.trigger_type === 'github_app'
    && app?.repo_id === CI_POLICY.repositoryId && app.repo_full_name === DISSERO_REPOSITORY
    && app.branch === 'main' && app.full_ref === 'refs/heads/main' && app.ref === 'main'
    && app.checkout_sha === sha && app.commit_sha === sha && repositoryUrl(app.repo_url)
    && git?.branch === 'main' && git.ref === 'refs/heads/main' && git.checkout_sha === sha && repositoryUrl(git.repo_url),
  'contexto de checkout/evento da pipeline divergente.');
  for (const p of [parameters?.circleci, app, git]) {
    if (p?.config_ref !== undefined) declaredRefs({ ref: p.config_ref }, sha);
    if (p?.config_sha !== undefined) declaredRefs({ revision: p.config_sha }, sha);
  }
  // This API does not expose a historical config-ref on this deployment. Bind actual
  // executed bytes to the Git blob at exact main SHA, and to the reviewed verify contract.
  const content = e.mainConfig;
  requireCi(content.type === 'file' && content.path === CI_POLICY.configPath && content.encoding === 'base64'
    && typeof content.content === 'string', 'blob da configuração de main ausente.');
  const source = Buffer.from(content.content, 'base64');
  const blob = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
  const digest = createHash('sha256').update(source).digest('hex');
  requireCi(content.sha === blob && content.size === source.length && digest === CI_POLICY.configSha256,
    'contrato verify de main mudou; revise seu fingerprint.');
  requireCi(typeof e.configuration.source === 'string' && Buffer.from(e.configuration.source).equals(source)
    && e.configuration.setup_config === '' && e.configuration.compiled_setup_config === '', 'config executada difere do blob de main ou usa setup dinâmico.');
  const workflow = latestWorkflow(e.workflows, run.id);
  requireCi(workflow.status === 'success' && timestamp(workflow.stopped_at) >= timestamp(workflow.created_at),
    'workflow mais recente pendente, pulado ou com falha.');
  const jobs = e.jobs.filter((job) => job.name === CI_POLICY.job);
  requireCi(jobs.length === 1, 'job verify omitido ou duplicado.');
  const job = jobs[0];
  requireCi(UUID.test(job.id) && job.type === 'build' && job.status === 'success'
    && Number.isSafeInteger(job.job_number) && job.job_number > 0
    && timestamp(job.stopped_at) >= timestamp(job.started_at), 'job verify não concluiu com sucesso.');
  requireCi(e.job.name === CI_POLICY.job && e.job.number === job.job_number && e.job.status === 'success'
    && e.job.project?.id === CI_POLICY.projectId && e.job.project.slug === CI_POLICY.projectSlug
    && e.job.organization?.name === CI_POLICY.organizationId && e.job.pipeline?.id === run.id, 'detalhe do job não pertence ao projeto/pipeline esperado.');
  if (e.job.latest_workflow?.id !== undefined) requireCi(e.job.latest_workflow.id === workflow.id, 'job pertence a outra tentativa de workflow.');
  return { provider: 'circleci', sha, branch: 'main', projectId: CI_POLICY.projectId,
    definitionId: CI_POLICY.definitionId, runId: run.id as string, runNumber: run.attributes.number as number,
    workflowId: workflow.id as string, jobId: job.id as string, jobNumber: job.job_number as number,
    workflow: CI_POLICY.workflow, job: CI_POLICY.job, configSha256: digest };
}

/** Every provider operation is an explicit GET through the official, already-authenticated CLI. */
export function checkCircleCi(sha: string, query: CiQuery) {
  fullSha(sha);
  const api = (path: string): Obj => {
    const output = query('circleci', ['api', path, '--method', 'GET']);
    try { return JSON.parse(output) as Obj; } catch { throw new Error('CircleCI não retornou JSON válido.'); }
  };
  const latest = (): Obj => {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const endpoint = `api/v3/runs?filter[project_id]=${CI_POLICY.projectId}&page[limit]=10${cursor ? `&page[cursor]=${encodeURIComponent(cursor)}` : ''}`;
      const response = api(endpoint);
      requireCi(Array.isArray(response.data), 'listagem de runs inválida.');
      const runs = response.data as Obj[];
      // Official endpoint returns most recent runs first. Validate sequence; never
      // search older pages after finding a newer main run that has not passed.
      for (let i = 0; i < runs.length; i++) {
        requireCi(Number.isSafeInteger(runs[i].attributes?.number)
          && (i === 0 || runs[i - 1].attributes.number > runs[i].attributes.number), 'ordem da listagem de runs inválida.');
      }
      if (runs.some((run) => run.references?.pipeline?.id === CI_POLICY.definitionId && run.references?.event?.attributes?.vcs?.branch === 'main')) {
        return latestMainRun(runs);
      }
      const next = response.page?.next;
      if (next === null || (next === undefined && runs.length < 10)) break;
      requireCi(typeof next === 'string' && next.length > 0 && !seen.has(next), 'paginação v3 incompleta.');
      seen.add(next);
      cursor = next;
    }
    throw new Error('CI CircleCI recusada: main não foi encontrada na janela de consulta.');
  };
  const items = (path: string): Obj[] => {
    const all: Obj[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const response = api(path + (cursor ? `?page-token=${encodeURIComponent(cursor)}` : ''));
      requireCi(Array.isArray(response.items), 'listagem v2 inválida.');
      all.push(...response.items);
      // This deployment omits the terminal v2 token rather than returning null.
      if (response.next_page_token === null || response.next_page_token === undefined) return all;
      requireCi(typeof response.next_page_token === 'string' && response.next_page_token.length > 0
        && !seen.has(response.next_page_token), 'paginação v2 incompleta.');
      cursor = response.next_page_token;
      seen.add(cursor);
    }
    throw new Error('CI CircleCI recusada: paginação excedeu o limite.');
  };
  const selected = latest();
  const run = api(`api/v3/runs/${selected.id}`);
  requireCi(run.data?.id === selected.id && run.data.attributes?.number === selected.attributes.number, 'run mudou durante a leitura.');
  requireCi(run.data.attributes.phase === 'ended' && run.data.attributes.current_outcome === 'succeeded', 'o run mais recente ainda não terminou com sucesso.');
  requireCi(run.data.references?.event?.attributes?.vcs?.revision === sha, 'run de main não corresponde ao SHA completo atual.');
  const workflows = items(`api/v2/pipeline/${selected.id}/workflow`);
  const workflow = latestWorkflow(workflows, selected.id);
  const jobs = items(`api/v2/workflow/${workflow.id}/job`);
  const verify = jobs.filter((job) => job.name === CI_POLICY.job);
  requireCi(verify.length === 1 && Number.isSafeInteger(verify[0].job_number), 'job verify ausente ou inválido.');
  const evidence: CiEvidence = {
    project: api(`api/v3/projects/${CI_POLICY.projectId}`), definition: api(`api/v3/pipelines/${CI_POLICY.definitionId}`), run,
    pipeline: api(`api/v2/pipeline/${selected.id}`), configuration: api(`api/v2/pipeline/${selected.id}/config`),
    mainConfig: JSON.parse(query('gh', ['api', `repos/${DISSERO_REPOSITORY}/contents/${CI_POLICY.configPath}?ref=${sha}`, '--method', 'GET'])) as Obj,
    workflows, jobs, job: api(`api/v2/project/${CI_POLICY.projectSlug}/job/${verify[0].job_number}`),
  };
  const proof = assertSuccessfulCi(evidence, sha);
  // Close the read window on the current run, any workflow rerun and the job state.
  const current = latest();
  requireCi(current.id === selected.id && current.attributes.number === selected.attributes.number, 'há um run de main mais recente.');
  const freshRun = api(`api/v3/runs/${selected.id}`);
  const freshWorkflows = items(`api/v2/pipeline/${selected.id}/workflow`);
  requireCi(latestWorkflow(freshWorkflows, selected.id).id === workflow.id, 'um rerun de workflow começou durante a leitura.');
  const freshJobs = items(`api/v2/workflow/${workflow.id}/job`);
  const fresh = assertSuccessfulCi({ ...evidence, run: freshRun, workflows: freshWorkflows, jobs: freshJobs,
    job: api(`api/v2/project/${CI_POLICY.projectSlug}/job/${proof.jobNumber}`) }, sha);
  requireCi(fresh.jobId === proof.jobId, 'job mudou durante a leitura.');
  return fresh;
}
