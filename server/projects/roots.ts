import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ProjectFolder } from '../../shared/projects';

/** Local fixed/removable volumes only; never enumerate mapped network drives. */
export function parseWindowsProjectRoots(raw: string): ProjectFolder[] {
  const letters = new Set([...raw.matchAll(/^\s*\\DosDevices\\([A-Za-z]:)\s+REG_BINARY\s+[a-f\d]+\s*$/gmi)].map((match) => match[1].toUpperCase()));
  return [...letters].sort().map((name) => ({ name, path: `${name}\\` }));
}

let cached: { at: number; roots: ProjectFolder[] } | undefined;
let pending: Promise<ProjectFolder[]> | undefined;

export async function localProjectRoots(): Promise<ProjectFolder[]> {
  if (process.platform !== 'win32') return [{ name: 'Sistema de arquivos', path: '/' }];
  if (cached && Date.now() - cached.at < 60_000) return cached.roots.map((root) => ({ ...root }));
  if (!pending) {
    const registry = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    pending = promisify(execFile)(registry, ['query', 'HKLM\\SYSTEM\\MountedDevices'], { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 })
      .then(async ({ stdout }) => {
        const roots = await Promise.all(parseWindowsProjectRoots(stdout).map(async (root) => {
          try {
            const resolved = await realpath(root.path);
            // Stale volume letters, UNC shares and drive aliases are not selectable physical roots.
            return /^[A-Za-z]:[\\/]$/.test(resolved) && (await stat(resolved)).isDirectory() ? root : null;
          } catch { return null; }
        }));
        return roots.filter((root): root is ProjectFolder => root !== null);
      })
      .catch(() => [])
      .then((roots) => { cached = { at: Date.now(), roots }; return roots; })
      .finally(() => { pending = undefined; });
  }
  return (await pending).map((root) => ({ ...root }));
}
