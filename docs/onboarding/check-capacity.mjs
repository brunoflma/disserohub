// Read-only, dependency-free preparation tool. No installer or plugin imports this file.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const POLICY = JSON.parse(fs.readFileSync(new URL('./capacity-policy.json', import.meta.url), 'utf8'));
const GiB = 1024 ** 3;
const valid = (value, minimum = 0) => Number.isFinite(value) && value >= minimum;

export function assessCapacity(observed, { method = 'native', policy = POLICY } = {}) {
  if (!Object.hasOwn(policy.profiles, method)) throw new RangeError('Método deve ser native ou docker.');
  const profile = policy.profiles[method];
  const issues = [];
  const add = (code, level, message) => issues.push({ code, level, message });
  const result = (recommended = false) => {
    const status = ['not_recommended', 'needs_review', 'defer'].find(level => issues.some(x => x.level === level)) ?? 'eligible';
    return {
      policyId: policy.id, policyStatus: policy.status, method, status,
      profile: status === 'eligible' ? (recommended ? 'recommended' : 'basic') : null,
      eligibleForAssistedInstall: status === 'eligible',
      installationAuthorized: false, integrationEnabled: false, issues,
      warnings: status === 'eligible' && method === 'native' && !recommended
        ? ['Perfil básico nativo via npm: validar compilação e responsividade com a carga habitual. Capacidade provisória; não é garantia de desempenho.'] : [],
    };
  };

  if (observed.environment !== 'host') {
    add('host_not_measured', 'needs_review', 'Diagnóstico feito em WSL, contêiner ou ambiente desconhecido. Medir também o sistema anfitrião; não somar RAM do host e da VM.');
    return result();
  }
  if (!observed.platform || !observed.architecture) {
    add('platform_unknown', 'needs_review', 'Sistema ou arquitetura não identificado.');
  } else if (!policy.platforms.includes(observed.platform) || !policy.architectures.includes(observed.architecture)) {
    add('platform_outside_policy', 'not_recommended', 'Sistema ou arquitetura fora do perfil preparado; exige validação separada.');
  }

  const minimum = profile.minimum;
  const recommended = profile.recommended;
  const totalKnown = valid(observed.totalMemoryGiB, 0.01);
  const availableKnown = totalKnown && valid(observed.availableMemoryGiB)
    && observed.availableMemoryGiB <= observed.totalMemoryGiB
    && ['available', 'lower-bound'].includes(observed.availableMemoryKind);
  const cpuKnown = Number.isInteger(observed.logicalCpuCount) && observed.logicalCpuCount > 0;
  const memoryMeets = threshold => totalKnown && observed.totalMemoryGiB + policy.totalMemoryToleranceGiB >= threshold;

  if (!totalKnown) add('total_memory_unknown', 'needs_review', 'RAM total não medida. Ausência de dado não significa zero.');
  else if (!memoryMeets(minimum.totalMemoryGiB)) add('total_memory_low', 'not_recommended', `Perfil assistido exige aproximadamente ${minimum.totalMemoryGiB} GiB de RAM total. Não iniciar instalação padrão.`);
  if (!cpuKnown) add('cpu_unknown', 'needs_review', 'Quantidade de CPUs lógicas não medida.');
  else if (observed.logicalCpuCount < minimum.logicalCpuCount) add('cpu_low', 'not_recommended', `Perfil assistido exige ${minimum.logicalCpuCount} CPUs lógicas disponíveis.`);
  if (!availableKnown) add('available_memory_unknown', 'needs_review', 'Memória disponível não medida de forma utilizável.');
  else if (observed.availableMemoryGiB < minimum.availableMemoryGiB) {
    add('available_memory_low', observed.availableMemoryKind === 'lower-bound' ? 'needs_review' : 'defer',
      observed.availableMemoryKind === 'lower-bound'
        ? 'Memória livre é apenas um limite inferior neste sistema. Conferir pressão de memória antes de decidir.'
        : `Menos de ${minimum.availableMemoryGiB} GiB disponíveis agora. Reduzir a carga por decisão do usuário e repetir o diagnóstico.`);
  }
  let recommendedDisks = true;
  for (const purpose of ['install', 'data']) {
    const free = observed.disks?.[purpose]?.availableGiB;
    if (!valid(free)) add(`${purpose}_disk_unknown`, 'needs_review', `Espaço livre do destino ${purpose} não medido.`);
    else if (free < minimum.freeDiskGiB) add(`${purpose}_disk_low`, 'defer', `Destino ${purpose} precisa de ${minimum.freeDiskGiB} GiB livres para este perfil. Não limpar arquivos automaticamente.`);
    recommendedDisks &&= valid(free) && free >= recommended.freeDiskGiB;
  }

  let recommendedDocker = true;
  if (method === 'docker') {
    const docker = observed.docker;
    if (!docker || docker.localityVerified !== true || !['vm', 'engine'].includes(docker.mode)) {
      add('docker_budget_unverified', 'needs_review', 'Conferir daemon local, modo Desktop/VM ou Engine Linux, orçamento de RAM/CPU e espaço no armazenamento real do Docker.');
      recommendedDocker = false;
    } else {
      const requirements = [
        ['memoryGiB', 'minimumMemoryGiB', 'recommendedMemoryGiB'],
        ['logicalCpuCount', 'minimumLogicalCpuCount', 'recommendedLogicalCpuCount'],
        ['storageAvailableGiB', 'minimumFreeDiskGiB', 'recommendedFreeDiskGiB'],
      ];
      if (docker.mode === 'engine' && observed.platform !== 'linux') add('docker_engine_host_unverified', 'needs_review', 'Este perfil Engine exige Linux nativo; validar a virtualização e o host separadamente.');
      for (const [field, minField, recommendedField] of requirements) {
        const value = docker[field];
        const known = valid(value) && (field !== 'logicalCpuCount' || Number.isInteger(value));
        if (!known) add(`docker_${field}_unknown`, 'needs_review', `Recurso Docker não medido: ${field}.`);
        else if (value < profile.daemon[minField]) add(`docker_${field}_low`, 'defer', `Orçamento Docker insuficiente: ${field}. Não alterar alocação ou reiniciar o daemon automaticamente.`);
        recommendedDocker &&= known && value >= profile.daemon[recommendedField];
      }
      if (valid(docker.memoryGiB) && totalKnown && docker.memoryGiB > observed.totalMemoryGiB + policy.totalMemoryToleranceGiB) {
        add('docker_memory_inconsistent', 'needs_review', 'RAM do daemon excede a do host medido; conferir se o contexto é remoto ou se as medições se referem à mesma máquina.');
      }
    }
  }
  return result(memoryMeets(recommended.totalMemoryGiB) && availableKnown && observed.availableMemoryGiB >= recommended.availableMemoryGiB
    && cpuKnown && observed.logicalCpuCount >= recommended.logicalCpuCount && recommendedDisks && recommendedDocker);
}

function diskAt(target) {
  let current = path.resolve(target);
  let source = 'target-filesystem';
  while (true) {
    try {
      const info = fs.statfsSync(current);
      const availableGiB = Number(info.bavail) * Number(info.bsize) / GiB;
      return { availableGiB: valid(availableGiB) ? availableGiB : null, source };
    } catch (error) {
      const parent = path.dirname(current);
      if (error.code !== 'ENOENT' || current === parent) return { availableGiB: null, source: 'unavailable' };
      current = parent;
      source = 'nearest-existing-ancestor-filesystem';
    }
  }
}

export function collectHost({ installDir = path.join(os.homedir(), 'disserohub'), dataDir = path.join(os.homedir(), '.habblaud') } = {}) {
  const platform = os.platform();
  let environment = 'host';
  if (process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release())) environment = 'wsl';
  else if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) environment = 'container';
  // A cgroup limit can be smaller than physical RAM even without a container marker.
  if (platform === 'linux' && environment === 'host') {
    for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
      try {
        const limit = Number(fs.readFileSync(file, 'utf8').trim());
        if (valid(limit, 1) && limit < os.totalmem()) environment = 'constrained';
      } catch { /* Missing or inaccessible limit is not proof of a limit. */ }
    }
  }
  let availableMemoryGiB = null;
  let availableMemoryKind = 'unknown';
  let memorySource = 'unavailable';
  if (platform === 'linux') {
    try {
      const match = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
      if (match) {
        availableMemoryGiB = Number(match[1]) * 1024 / GiB;
        availableMemoryKind = 'available';
        memorySource = '/proc/meminfo:MemAvailable';
      }
    } catch { /* Keep the missing measurement explicit. */ }
  } else if (platform === 'win32' || platform === 'darwin') {
    availableMemoryGiB = os.freemem() / GiB;
    availableMemoryKind = platform === 'darwin' ? 'lower-bound' : 'available';
    memorySource = 'node:os.freemem';
  }
  const cpus = os.cpus().length;
  const logicalCpuCount = cpus > 0 ? Math.min(cpus, os.availableParallelism()) : null;
  return {
    schemaVersion: 1, measuredAt: new Date().toISOString(), platform, architecture: os.arch(), environment,
    totalMemoryGiB: os.totalmem() / GiB, availableMemoryGiB, availableMemoryKind, memorySource, logicalCpuCount,
    disks: { install: diskAt(installDir), data: diskAt(dataDir) },
    docker: null,
  };
}

function main(args) {
  const options = { method: 'native' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Uso: node docs/onboarding/check-capacity.mjs [--method native|docker] [--install-dir CAMINHO] [--data-dir CAMINHO]\nSomente leitura; saída JSON local. Não instala, não envia dados e não consulta o Docker.');
      return;
    }
    const key = { '--method': 'method', '--install-dir': 'installDir', '--data-dir': 'dataDir' }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Argumentos inválidos; consulte --help.');
    options[key] = args[++i];
  }
  if (!Object.hasOwn(POLICY.profiles, options.method)) throw new Error('Método deve ser native ou docker.');
  const observed = collectHost(options);
  const assessment = assessCapacity(observed, options);
  console.log(JSON.stringify({ observed, assessment }, null, 2));
  // A positive result is a capacity gate only, never installation consent or full OS compatibility.
  process.exitCode = assessment.eligibleForAssistedInstall ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Não foi possível concluir o diagnóstico; confira os argumentos e use --help.'); process.exitCode = 1; }
}
