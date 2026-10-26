import { randomUUID } from 'node:crypto';
import { readFileSync, type Dirent } from 'node:fs';
import { mkdir, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, parse } from 'node:path';
import type { RegisteredProject, ProjectFolderView, ProjectFolder } from '../../shared/projects';
import { localProjectRoots } from './roots';
export type { RegisteredProject, ProjectFolderView } from '../../shared/projects';

const MAX_PROJECTS = 100;
const MAX_FOLDERS = 500;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/**
 * A small local registry for folders the user chose as projects. It deliberately
 * stores only the canonical path and the time it was registered.
 */
export class ProjectFolders {
  private mutationQueue: Promise<void> = Promise.resolve();
  private projects: RegisteredProject[] = [];
  private readonly home: string;

  constructor(private readonly file: string | null, home: string, private readonly rootProvider: () => Promise<ProjectFolder[]> = localProjectRoots) {
    this.home = nativeAbsolutePath(home, 'home');
  }

  load(): void {
    const projects = this.readStoredProjects();
    this.projects = projects;
  }

  entries(): RegisteredProject[] {
    return this.projects.map(copyProject);
  }

  async browse(raw?: string): Promise<ProjectFolderView> {
    const directory = await canonicalDirectory(raw === undefined ? this.home : raw);
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { encoding: 'utf8', withFileTypes: true });
    } catch (err) {
      throw operationError(`cannot list project folder "${directory}"`, err);
    }

    const folders = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const roots = await this.rootProvider().catch(() => []);
    const root = parse(this.home).root;
    return {
      path: directory,
      parent: dirname(directory) === directory ? null : dirname(directory),
      folders: folders.slice(0, MAX_FOLDERS),
      truncated: folders.length > MAX_FOLDERS,
      roots: roots.length ? roots : [{ name: root.replace(/[\\/]$/, '') || root, path: root }],
    };
  }

  async add(raw: string): Promise<RegisteredProject> {
    const path = await canonicalDirectory(raw);
    return this.enqueue(() => this.register(path));
  }

  /** Remove somente a entrada do cadastro, sem tocar na pasta ou nas sessões. */
  async remove(raw: string): Promise<RegisteredProject | undefined> {
    const path = nativeAbsolutePath(raw, 'project folder');
    return this.enqueue(() => this.unregister(path));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async register(path: string): Promise<RegisteredProject> {
    const current = this.file ? this.readStoredProjects() : this.projects;
    const key = pathKey(path);
    const existing = current.find((project) => pathKey(project.path) === key);
    if (existing) {
      this.projects = current;
      return copyProject(existing);
    }
    if (current.length >= MAX_PROJECTS) throw new Error(`cannot register more than ${MAX_PROJECTS} projects`);

    const project: RegisteredProject = { path, createdAt: Date.now() };
    const next = [...current, project];
    await this.persist(next);
    this.projects = next;
    return copyProject(project);
  }

  private async unregister(path: string): Promise<RegisteredProject | undefined> {
    const current = this.file ? this.readStoredProjects() : this.projects;
    const key = pathKey(path);
    const removed = current.find((project) => pathKey(project.path) === key);
    if (!removed) {
      this.projects = current;
      return undefined;
    }
    const next = current.filter((project) => pathKey(project.path) !== key);
    await this.persist(next);
    this.projects = next;
    return copyProject(removed);
  }

  private readStoredProjects(): RegisteredProject[] {
    if (!this.file) return [];

    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw operationError(`cannot read project registrations from "${this.file}"`, err);
    }

    try {
      return parseStoredProjects(raw, this.file);
    } catch (err) {
      throw operationError(`invalid project registrations in "${this.file}"`, err);
    }
  }

  private async persist(projects: RegisteredProject[]): Promise<void> {
    if (!this.file) return;

    // Recheck the destination immediately before writing so an unreadable or
    // malformed existing file can never be replaced by a new registration.
    this.readStoredProjects();
    await mkdir(dirname(this.file), { recursive: true });

    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    let moved = false;
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, this.file);
      moved = true;
    } catch (err) {
      throw operationError(`cannot persist project registrations to "${this.file}"`, err);
    } finally {
      if (!moved) await unlink(temporary).catch(() => undefined);
    }
  }
}

async function canonicalDirectory(raw: string): Promise<string> {
  const normalized = nativeAbsolutePath(raw, 'project folder');
  let directory: string;
  try {
    directory = await realpath(normalized);
  } catch (err) {
    throw operationError(`cannot resolve project folder "${raw}"`, err);
  }

  try {
    nativeAbsolutePath(directory, 'resolved project folder');
    if (!(await stat(directory)).isDirectory()) throw new Error('path is not a directory');
  } catch (err) {
    throw operationError(`project folder is not a directory "${raw}"`, err);
  }
  return directory;
}

function nativeAbsolutePath(raw: string, label: string): string {
  if (!raw || CONTROL_CHARACTER.test(raw)) throw new Error(`${label} contains an empty or control-character path`);
  if (URL_SCHEME.test(raw) && !WINDOWS_ABSOLUTE.test(raw)) throw new Error(`${label} must be a native filesystem path, not a URL`);
  if (raw.startsWith('\\\\') || raw.startsWith('//')) throw new Error(`${label} cannot be a UNC, device, or network path`);
  if (!isAbsolute(raw)) throw new Error(`${label} must be an absolute path`);
  if (process.platform === 'win32' && !WINDOWS_ABSOLUTE.test(raw)) throw new Error(`${label} must be a drive-qualified Windows path`);
  return normalize(raw);
}

function parseStoredProjects(raw: string, file: string): RegisteredProject[] {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (err) {
    throw operationError(`JSON could not be parsed for "${file}"`, err);
  }
  if (!isRecord(value) || value.version !== 1 || !onlyKeys(value, ['version', 'projects']) || !Array.isArray(value.projects)) {
    throw new Error('expected { version: 1, projects: [...] }');
  }
  if (value.projects.length > MAX_PROJECTS) throw new Error(`registration file contains more than ${MAX_PROJECTS} projects`);

  const projects: RegisteredProject[] = [];
  const keys = new Set<string>();
  for (const [index, item] of value.projects.entries()) {
    const createdAt = isRecord(item) ? item.createdAt : undefined;
    if (!isRecord(item) || !onlyKeys(item, ['path', 'createdAt']) || typeof item.path !== 'string' || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new Error(`project entry ${index} is malformed`);
    }
    const path = nativeAbsolutePath(item.path, `project entry ${index}`);
    const key = pathKey(path);
    if (keys.has(key)) throw new Error(`project entry ${index} duplicates another project`);
    keys.add(key);
    projects.push({ path, createdAt });
  }
  return projects;
}

function pathKey(path: string): string {
  const normalized = normalize(path);
  const withoutTrailingSeparator = normalized.length > 1 ? normalized.replace(/[\\/]$/, '') : normalized;
  return process.platform === 'win32' ? withoutTrailingSeparator.toLowerCase() : withoutTrailingSeparator;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyProject(project: RegisteredProject): RegisteredProject {
  return { ...project };
}

function operationError(message: string, cause: unknown): Error {
  return new Error(`${message}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}
