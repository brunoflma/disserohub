import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { ProjectFolders } from './folders';

describe('ProjectFolders', () => {
  it('keeps other roots selectable independently of the current directory', async () => {
    const fixture = tempDir('habblaud-project-roots-');
    try {
      const first = join(fixture.dir, 'first'), second = join(fixture.dir, 'second');
      mkdirSync(first); mkdirSync(second);
      const roots = [{ name: 'first', path: first }, { name: 'second', path: second }];
      const store = new ProjectFolders(null, first, async () => roots);
      expect((await store.browse()).roots).toEqual(roots);
      const view = await store.browse(second);
      expect(view.path).toBe(second);
      expect(view.roots).toEqual(roots);
      expect(store.entries()).toEqual([]);
    } finally { fixture.cleanup(); }
  });
  it('preserves distinct projects added concurrently', async () => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const first = join(fixture.dir, 'first'), second = join(fixture.dir, 'second');
      mkdirSync(first); mkdirSync(second);
      const file = join(fixture.dir, 'projects.json');
      const store = new ProjectFolders(file, fixture.dir);
      store.load();
      await Promise.all([store.add(first), store.add(second), store.add(first)]);
      const restored = new ProjectFolders(file, fixture.dir);
      restored.load();
      expect(new Set(restored.entries().map((p) => p.path))).toEqual(new Set([first, second]));
    } finally { fixture.cleanup(); }
  });
  it('browses canonical directories and returns only sorted child directories', async ({ skip }) => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const home = join(fixture.dir, 'home folder');
      const selected = join(home, 'selected é folder');
      const nested = join(home, 'nested');
      mkdirSync(selected, { recursive: true });
      mkdirSync(nested, { recursive: true });
      mkdirSync(join(selected, 'zeta folder'));
      mkdirSync(join(selected, 'alpha ü folder'));
      writeFileSync(join(selected, 'a-file.txt'), 'file contents');

      let linkCreated = false;
      try {
        symlinkSync(join(selected, 'zeta folder'), join(selected, 'linked folder'), process.platform === 'win32' ? 'junction' : 'dir');
        linkCreated = true;
      } catch (err) {
        if (process.platform === 'win32' && (err as NodeJS.ErrnoException).code === 'EPERM') {
          skip('Windows did not allow the fixture junction');
          return;
        }
        throw err;
      }

      const store = new ProjectFolders(null, home);
      const raw = `${selected}${sep}..${sep}${basename(selected)}`;
      const view = await store.browse(raw);

      expect(view.path).toBe(selected);
      expect(view.parent).toBe(home);
      expect(view.folders.map((folder) => folder.name)).toEqual(['alpha ü folder', 'zeta folder']);
      expect(view.folders.every((folder) => folder.path.startsWith(`${selected}${sep}`))).toBe(true);
      expect(view.folders.some((folder) => folder.name === 'a-file.txt')).toBe(false);
      expect(view.folders.some((folder) => folder.name === 'linked folder')).toBe(false);
      expect(linkCreated).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('uses home when no path is provided and truncates large listings at 500 folders', async () => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const home = join(fixture.dir, 'home');
      mkdirSync(home, { recursive: true });
      for (let i = 0; i < 505; i++) mkdirSync(join(home, `folder-${String(i).padStart(3, '0')}`));

      const view = await new ProjectFolders(null, home).browse();

      expect(view.path).toBe(home);
      expect(view.folders).toHaveLength(500);
      expect(view.folders[0]?.name).toBe('folder-000');
      expect(view.folders[499]?.name).toBe('folder-499');
      expect(view.truncated).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('canonicalizes, persists, reloads, and idempotently re-adds a project', async () => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const home = join(fixture.dir, 'home');
      const project = join(home, 'Project With Spaces é');
      const storeFile = join(fixture.dir, 'state', 'projects.json');
      mkdirSync(project, { recursive: true });
      writeFileSync(join(project, 'keep.txt'), 'keep me');

      const store = new ProjectFolders(storeFile, home);
      store.load();
      const first = await store.add(`${home}${sep}missing${sep}..${sep}${basename(project)}`);
      const beforeProjectFile = readFileSync(join(project, 'keep.txt'), 'utf8');
      expect(first.path).toBe(project);
      expect(first.createdAt).toBeTypeOf('number');
      expect(readFileSync(join(project, 'keep.txt'), 'utf8')).toBe(beforeProjectFile);
      expect(JSON.parse(readFileSync(storeFile, 'utf8'))).toEqual({ version: 1, projects: [first] });

      const reloaded = new ProjectFolders(storeFile, home);
      reloaded.load();
      const duplicateInput = process.platform === 'win32' ? project.replace('Project With Spaces é', 'project with spaces é') : project;
      const duplicate = await reloaded.add(duplicateInput);
      expect(duplicate).toEqual(first);
      expect(reloaded.entries()).toEqual([first]);
    } finally {
      fixture.cleanup();
    }
  });

  it('removes only the registration and persists that removal', async () => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const home = join(fixture.dir, 'home');
      const project = join(home, 'project');
      const storeFile = join(fixture.dir, 'state', 'projects.json');
      mkdirSync(project, { recursive: true });
      writeFileSync(join(project, 'keep.txt'), 'keep me');

      const store = new ProjectFolders(storeFile, home);
      store.load();
      const registered = await store.add(project);
      expect(await store.remove(project)).toEqual(registered);
      expect(store.entries()).toEqual([]);
      expect(existsSync(project)).toBe(true);
      expect(readFileSync(join(project, 'keep.txt'), 'utf8')).toBe('keep me');

      const reloaded = new ProjectFolders(storeFile, home);
      reloaded.load();
      expect(reloaded.entries()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects files, relative paths, URLs, control characters, and non-native roots', async () => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const home = join(fixture.dir, 'home');
      const project = join(home, 'project');
      const file = join(home, 'file.txt');
      mkdirSync(project, { recursive: true });
      mkdirSync(home, { recursive: true });
      writeFileSync(file, 'not a directory');

      const store = new ProjectFolders(null, home);
      const invalid = [
        file,
        'relative/project',
        'https://example.test/project',
        'file:///project',
        String.raw`\\server\share\project`,
        String.raw`\\?\C:\project`,
        '//server/share/project',
        `${project}\0`,
        `${project}\n`,
      ];
      for (const raw of invalid) await expect(store.add(raw)).rejects.toThrow();
      expect(store.entries()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps malformed registration data intact and does not mutate state on persistence failure', async () => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const home = join(fixture.dir, 'home');
      const project = join(home, 'project');
      const malformedFile = join(fixture.dir, 'malformed.json');
      const malformed = '{"version":1,"projects":[broken]}\n';
      mkdirSync(project, { recursive: true });
      writeFileSync(malformedFile, malformed);

      const malformedStore = new ProjectFolders(malformedFile, home);
      expect(() => malformedStore.load()).toThrow(/invalid project registrations/);
      expect(readFileSync(malformedFile, 'utf8')).toBe(malformed);
      await expect(malformedStore.add(project)).rejects.toThrow(/invalid project registrations/);
      expect(malformedStore.entries()).toEqual([]);
      expect(readFileSync(malformedFile, 'utf8')).toBe(malformed);

      const directoryAsFile = join(fixture.dir, 'store-directory');
      mkdirSync(directoryAsFile);
      const failedStore = new ProjectFolders(directoryAsFile, home);
      await expect(failedStore.add(project)).rejects.toThrow();
      expect(failedStore.entries()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('caps registrations at 100 and accepts no more after the cap', async () => {
    const fixture = tempDir('habblaud-project-folders-');
    try {
      const home = join(fixture.dir, 'home');
      mkdirSync(home, { recursive: true });
      const store = new ProjectFolders(null, home);
      store.load();
      for (let i = 0; i < 100; i++) {
        const project = join(home, `project-${i}`);
        mkdirSync(project);
        await store.add(project);
      }
      const tooMany = join(home, 'project-100');
      mkdirSync(tooMany);

      expect(store.entries()).toHaveLength(100);
      await expect(store.add(tooMany)).rejects.toThrow(/100/);
      expect(store.entries()).toHaveLength(100);
    } finally {
      fixture.cleanup();
    }
  });
});

function basename(path: string): string {
  return path.slice(path.lastIndexOf(sep) + 1);
}
