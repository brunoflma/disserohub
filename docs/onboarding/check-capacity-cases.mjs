// Run explicitly with node --test. The cases suffix keeps these out of the Vitest suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCapacity, collectHost } from './check-capacity.mjs';

const host = changes => ({
  platform: 'win32', architecture: 'x64', environment: 'host',
  totalMemoryGiB: 16, availableMemoryGiB: 5, availableMemoryKind: 'available', logicalCpuCount: 4,
  disks: { install: { availableGiB: 30 }, data: { availableGiB: 30 } }, ...changes,
});
const dockerHost = changes => host({
  totalMemoryGiB: 32, availableMemoryGiB: 12, logicalCpuCount: 8,
  disks: { install: { availableGiB: 50 }, data: { availableGiB: 50 } },
  docker: { localityVerified: true, mode: 'vm', memoryGiB: 8, logicalCpuCount: 4, storageAvailableGiB: 30 }, ...changes,
});
const assessDocker = changes => assessCapacity(dockerHost(changes), { method: 'docker' });

test('8 GiB may qualify for basic native use without authorizing installation', () => {
  const result = assessCapacity(host({ totalMemoryGiB: 8 }));
  assert.equal(result.status, 'eligible');
  assert.equal(result.profile, 'basic');
  assert.equal(result.eligibleForAssistedInstall, true);
  assert.equal(result.installationAuthorized, false);
  assert.ok(result.warnings.length > 0);
  assert.ok(!result.issues.some(x => x.code.startsWith('docker_')));
});
test('16 GiB with headroom qualifies for the native capacity profile', () => {
  const result = assessCapacity(host());
  assert.equal(result.status, 'eligible');
  assert.equal(result.profile, 'recommended');
  assert.equal(result.integrationEnabled, false);
  assert.equal(result.installationAuthorized, false);
});
test('native recommendations depend on available resources, not a 32 GiB requirement', () => {
  assert.equal(assessCapacity(host({ totalMemoryGiB: 32 })).profile, 'recommended');
  assert.equal(assessCapacity(host()).profile, 'recommended');
  assert.equal(assessCapacity(host({ totalMemoryGiB: 32, availableMemoryGiB: 2 })).profile, 'basic');
});
test('small OS memory reservations have a bounded tolerance', () => {
  assert.equal(assessCapacity(host({ totalMemoryGiB: 7.6 })).status, 'eligible');
  assert.equal(assessCapacity(host({ totalMemoryGiB: 7.49 })).status, 'not_recommended');
});
test('temporarily low available memory defers even on a 32 GiB host', () => {
  assert.equal(assessCapacity(host({ totalMemoryGiB: 32, availableMemoryGiB: 1 })).status, 'defer');
});
test('unknown, invalid or contradictory memory measurements never pass', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, '5', 100]) {
    assert.equal(assessCapacity(host({ availableMemoryGiB: value })).status, 'needs_review');
  }
  assert.equal(assessCapacity(host({ totalMemoryGiB: null })).status, 'needs_review');
});
test('macOS free memory is a lower bound, not a low-memory verdict', () => {
  assert.equal(assessCapacity(host({ platform: 'darwin', availableMemoryKind: 'lower-bound', availableMemoryGiB: 1 })).status, 'needs_review');
  assert.equal(assessCapacity(host({ platform: 'darwin', availableMemoryKind: 'lower-bound' })).status, 'eligible');
});
test('WSL, container and constrained-process readings do not classify the physical host', () => {
  for (const environment of ['wsl', 'container', 'constrained', 'unknown']) {
    const result = assessCapacity(host({ environment, totalMemoryGiB: 4 }));
    assert.equal(result.status, 'needs_review');
    assert.ok(!result.issues.some(x => x.code === 'total_memory_low'));
  }
});
test('CPU policy counts logical CPUs; missing and fractional values require review', () => {
  assert.equal(assessCapacity(host({ logicalCpuCount: 2 })).profile, 'basic');
  assert.equal(assessCapacity(host({ logicalCpuCount: 1 })).status, 'not_recommended');
  for (const value of [null, 0, 3.5]) assert.equal(assessCapacity(host({ logicalCpuCount: value })).status, 'needs_review');
});
test('each destination filesystem must be measured', () => {
  assert.equal(assessCapacity(host({ disks: { install: { availableGiB: 20 }, data: { availableGiB: 2 } } })).status, 'defer');
  assert.equal(assessCapacity(host({ disks: { install: { availableGiB: 20 } } })).status, 'needs_review');
  assert.equal(assessCapacity(host({ disks: { install: { availableGiB: 20 }, data: { availableGiB: 0 } } })).status, 'defer');
});
test('unknown and unsupported platforms are distinct', () => {
  assert.equal(assessCapacity(host({ platform: null })).status, 'needs_review');
  assert.equal(assessCapacity(host({ architecture: 'ia32' })).status, 'not_recommended');
});
test('Docker cannot qualify on host RAM alone or on a remote/unverified daemon', () => {
  assert.equal(assessDocker({ docker: null }).status, 'needs_review');
  assert.equal(assessDocker({ docker: { localityVerified: false, mode: 'vm', memoryGiB: 8 } }).status, 'needs_review');
});
test('Docker checks actual daemon memory, CPU and storage independently', () => {
  assert.equal(assessDocker().profile, 'recommended');
  for (const changes of [{ memoryGiB: 2 }, { logicalCpuCount: 1 }, { storageAvailableGiB: 2 }]) {
    assert.equal(assessDocker({ docker: { ...dockerHost().docker, ...changes } }).status, 'defer');
  }
  assert.equal(assessDocker({ docker: { ...dockerHost().docker, storageAvailableGiB: null } }).status, 'needs_review');
  assert.equal(assessDocker({ docker: { ...dockerHost().docker, memoryGiB: 64 } }).status, 'needs_review');
});
test('a 16 GiB Docker host can meet the basic policy after independent budget verification', () => {
  assert.equal(assessDocker({ totalMemoryGiB: 16, availableMemoryGiB: 6 }).profile, 'basic');
  assert.equal(assessDocker({ totalMemoryGiB: 16, availableMemoryGiB: 5 }).status, 'defer');
});
test('the same 8 GiB host passes native capacity but not Docker policy', () => {
  const observed = host({ totalMemoryGiB: 8, availableMemoryGiB: 3, logicalCpuCount: 2 });
  assert.equal(assessCapacity(observed).profile, 'basic');
  assert.equal(assessCapacity(observed, { method: 'docker' }).status, 'not_recommended');
});
test('basic native capacity still checks headroom and disk, with Docker entirely optional', () => {
  const observed = host({ totalMemoryGiB: 8, availableMemoryGiB: 2, logicalCpuCount: 2 });
  assert.equal(assessCapacity(observed).status, 'eligible');
  assert.equal(assessCapacity({ ...observed, availableMemoryGiB: 1.9 }).status, 'defer');
  assert.equal(assessCapacity({ ...observed, disks: { install: { availableGiB: 9 }, data: { availableGiB: 30 } } }).status, 'defer');
  assert.equal(assessCapacity({ ...observed, docker: { localityVerified: false } }).status, 'eligible');
});
test('Docker Engine does not inherit Desktop VM prerequisites but requires a Linux host', () => {
  const docker = { ...dockerHost().docker, mode: 'engine' };
  assert.equal(assessDocker({ platform: 'linux', docker }).status, 'eligible');
  assert.equal(assessDocker({ docker }).status, 'needs_review');
});
test('invalid methods cannot select inherited object properties', () => {
  for (const method of ['other', '__proto__', 'constructor']) assert.throws(() => assessCapacity(host(), { method }), RangeError);
});
test('collector emits measurements without user, machine, CPU model or destination identities', () => {
  const observed = collectHost();
  assert.ok(Number.isFinite(observed.totalMemoryGiB));
  assert.equal(observed.docker, null);
  for (const key of ['hostname', 'username', 'installDir', 'dataDir', 'cpuModel', 'serialNumber']) assert.equal(key in observed, false);
  assert.deepEqual(Object.keys(observed.disks.install).sort(), ['availableGiB', 'source']);
});
