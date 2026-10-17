/** Public visual workspace; the hosted Dissero plugin has a separate lifecycle. */
export const DISSERO_REPOSITORY = 'brunoflma/disserohub';
export const UPSTREAM_REPOSITORY = 'marmottajr/habblaud';
export const UPSTREAM_BASE_VERSION = '0.11.0';
/** Official release reviewed for this distribution number; it is not a claim of a full engine merge. */
export const UPSTREAM_REFERENCE_VERSION = '1.0.3';

/** Public revisions use x.y.z.n; package/plugin versions retain their npm-compatible base. */
export function distributionVersion(pkg: { version: string; disserohub?: { revision?: number } }): string {
  const revision = pkg.disserohub?.revision === undefined ? 0 : pkg.disserohub.revision;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 999_999) {
    throw new Error('A revisão do DisseroHub deve ser um inteiro de 0 a 999999.');
  }
  return revision ? `${pkg.version}.${revision}` : pkg.version;
}
