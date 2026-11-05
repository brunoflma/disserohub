import { join, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { checkFile, DELIVERY_FILE_MAX_BYTES, fileType, insideKnownFolder, pathProblem } from './files';

describe('arquivos das entregas', () => {
  it('só tipos de ver e nada com cara de segredo', () => {
    expect(fileType('/a/b.PNG')).toEqual({ kind: 'image', type: 'image/png' });
    expect(fileType('/a/b.pdf')?.kind).toBe('pdf');
    expect(fileType('/a/b.json')).toBeUndefined();
    expect(pathProblem('/Users/a/p/relatorio.pdf')).toBeUndefined();
    expect(pathProblem(win32.join('C:\\', 'Users', 'a', 'p', 'relatorio.pdf'))).toBeUndefined();
    for (const bad of ['/Users/a/.ssh/x.png', '/Users/a/p/.env.png', '/Users/a/p/secret-plan.pdf', '/Users/a/p/server.key', '/Users/a/.aws/c.txt', '/Users/a/.habblaud/remote-tls/ca.pdf', 'rel.png', '/a/../b.png', '/a/b.sh', '/a/id_ed25519']) {
      expect(pathProblem(bad), bad).toBeDefined();
    }
    for (const bad of [win32.join('C:\\', 'Users', 'a', '.ssh', 'x.png'), win32.join('C:\\', 'Users', 'a', 'p', '.env.png'), win32.join('C:\\', 'Users', 'a', 'id_ed25519'), win32.join('C:\\', 'Users', 'a', 'p', '..', 'secret.pdf')]) {
      expect(pathProblem(bad), bad).toBeDefined();
    }
  });

  it('checkFile: confere o caminho real (link para segredo cai), tamanho e tipo', () => {
    const fs = (real: string, size = 10, file = true) => ({ realpath: () => real, stat: () => ({ isFile: () => file, size }) });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png'))).toEqual({ path: '/Users/a/p/x.png', size: 10 });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/.ssh/x.png'))).toEqual({ error: 'arquivo protegido' });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png', DELIVERY_FILE_MAX_BYTES + 1))).toHaveProperty('error');
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png', 1, false))).toEqual({ error: 'não é um arquivo' });
    expect(checkFile('/nao/existe.png')).toEqual({ error: 'arquivo não encontrado' });
  });

  it('insideKnownFolder: só pastas de projeto que alguma conta conhece, as temporárias e os anexos', () => {
    const fixture = tempDir('habblaud-known-folders-');
    try {
      const accountDirs = [join(fixture.dir, 'home', '.claude'), join(fixture.dir, 'home', '.claude-2')];
      const project = join(fixture.dir, 'Users', 'ana', 'loja');
      const secondProject = join(fixture.dir, 'Users', 'ana', 'x-y');
      const encode = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-');
      const known = new Set([
        join(accountDirs[0], 'projects', encode(project)),
        join(accountDirs[1], 'projects', encode(secondProject)),
      ]);
      const tempRoot = join(fixture.dir, 'tmp');
      const attachmentsRoot = join(fixture.dir, 'home', '.habblaud', 'attachments');
      const opts = { accountDirs, roots: [tempRoot, attachmentsRoot], exists: (p: string) => known.has(p) };

      expect(insideKnownFolder(join(project, 'docs', 'print.png'), opts)).toBe(true);
      expect(insideKnownFolder(join(secondProject, 'a.pdf'), opts)).toBe(true);
      expect(insideKnownFolder(join(tempRoot, 'claude', 'scratch', 'tela.png'), opts)).toBe(true);
      expect(insideKnownFolder(join(attachmentsRoot, '20261013-ab', 'foto.jpg'), opts)).toBe(true);

      // Pastas não cadastradas, raízes em si, traversal e irmãos com prefixo parecido seguem negados.
      expect(insideKnownFolder(join(fixture.dir, 'Users', 'ana', 'Documents', 'extrato.pdf'), opts)).toBe(false);
      expect(insideKnownFolder(join(fixture.dir, 'Users', 'ana', 'lojas', 'a.png'), opts)).toBe(false);
      expect(insideKnownFolder(join(project, '..', 'loja-sibling', 'a.png'), opts)).toBe(false);
      expect(insideKnownFolder(tempRoot, opts)).toBe(false);
      expect(insideKnownFolder(join(tempRoot, '..', 'tmpx', 'a.png'), opts)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
});
