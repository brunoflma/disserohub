import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distributionVersion } from '../../shared/distribution';

const ROOT = join(import.meta.dirname, '..', '..');

describe('installation guide public-version contract', () => {
  for (const name of ['INSTALAR-COM-DOCKER.md', 'INSTALAR-SEM-DOCKER.md']) {
    it(`${name} accepts distribution revisions without comparing the npm base directly`, () => {
      const guide = readFileSync(join(ROOT, 'docs/onboarding', name), 'utf8');
      expect(guide).toContain('`vX.Y.Z` ou `vX.Y.Z.N`');
      expect(guide).toContain('`v` + `distributionVersion(package.json)`');
      expect(guide).toContain('`disserohub.revision`');
      expect(guide).toContain('revisão ausente ou zero');
      expect(guide).toContain('pare antes de instalar dependências');
      expect(guide).not.toContain('compare a versão de `package.json` com a tag');
      expect(guide).not.toContain('compare `package.json` com a tag');
      expect(guide).toContain(`\`v${distributionVersion({ version: '1.0.3', disserohub: { revision: 11 } })}\``);
      expect(guide).toContain(`\`v${distributionVersion({ version: '1.0.3', disserohub: { revision: 0 } })}\``);
    });
  }
});
