import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { UpdateInstallStatus } from '../../shared/update-install';

export const PROTOCOL = 1;
export const JOB_ID = /^[a-f0-9]{32}$/;
export const RELEASE_DIR = /^v\d+\.\d+\.\d+(?:\.\d+)?-[a-f0-9]{12}-[a-f0-9]{8}$/;
export interface ReleaseRef { dir: string; version: string; sha: string }
export interface Transaction { protocol: 1; target: ReleaseRef; previous: ReleaseRef | null; deadline: number }
export type Decision = 'commit' | 'rollback';
export const updateDir = (dataDir: string) => join(dataDir, 'updates');
export const transactionDir = (dataDir: string, id: string) => {
  if (!JOB_ID.test(id)) throw new Error('Invalid update id');
  return join(updateDir(dataDir), 'transactions', id);
};
export function readJson<T>(file: string): T | undefined {
  try {
    if (statSync(file).size > 32_768) return undefined;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch { return undefined; }
}
export function atomicJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(8).toString('hex')}.writing`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
}
/** The exclusive create is the linearization point shared by worker and bootstrap. */
export function decide(dataDir: string, id: string, choice: Decision): Decision {
  const file = join(transactionDir(dataDir, id), 'decision.json');
  const temp = `${file}.${randomBytes(8).toString('hex')}.writing`;
  writeFileSync(temp, JSON.stringify({ choice }), { flag: 'wx', mode: 0o600 });
  try { linkSync(temp, file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return readJson<{ choice: Decision }>(file)?.choice === 'commit' ? 'commit' : 'rollback';
  }
  finally { unlinkSync(temp); }
  return choice;
}
export function decision(dataDir: string, id: string): Decision | undefined {
  const file = join(transactionDir(dataDir, id), 'decision.json');
  if (!existsSync(file)) return undefined;
  return readJson<{ choice: Decision }>(file)?.choice === 'commit' ? 'commit' : 'rollback';
}
export function currentId(dataDir: string): string | undefined {
  const id = readJson<{ id: string }>(join(updateDir(dataDir), 'active.json'))?.id;
  return typeof id === 'string' && JOB_ID.test(id) ? id : undefined;
}
export function readTransaction(dataDir: string, id: string): Transaction {
  const tx = readJson<Transaction>(join(transactionDir(dataDir, id), 'transaction.json'));
  if (!tx || tx.protocol !== PROTOCOL || !Number.isFinite(tx.deadline) || !validRef(tx.target) || (tx.previous !== null && !validRef(tx.previous))) throw new Error('Invalid update transaction');
  return tx;
}
export function validRef(ref: ReleaseRef): boolean {
  return !!ref && typeof ref.dir === 'string' && RELEASE_DIR.test(ref.dir) && /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(ref.version) && /^[a-f0-9]{40}$/.test(ref.sha);
}
export function releasePath(dataDir: string, ref: ReleaseRef): string {
  if (!validRef(ref)) throw new Error('Invalid release reference');
  const root = realpathSync(join(dataDir, 'releases'));
  const target = realpathSync(join(root, ref.dir));
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== target) throw new Error('Release outside managed directory');
  return target;
}
export function selectedRelease(dataDir: string): ReleaseRef | null {
  const id = currentId(dataDir);
  if (!id) return null;
  const tx = readTransaction(dataDir, id);
  return decision(dataDir, id) === 'rollback' ? tx.previous : tx.target;
}
export function publicStatus(dataDir: string): UpdateInstallStatus | undefined {
  return readJson<UpdateInstallStatus>(join(updateDir(dataDir), 'install-status.json'));
}
export function saveStatus(dataDir: string, value: UpdateInstallStatus): void {
  atomicJson(join(updateDir(dataDir), 'install-status.json'), { ...value, updatedAt: Date.now() });
}
