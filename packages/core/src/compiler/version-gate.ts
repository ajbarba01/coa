import type { BundleManifest } from '@coa/shared';

/**
 * M5 — the D132 SemVer + breaking-change gate for bundles. `versionGate` diffs a
 * bundle's **declared public surface** against its prior manifest and classifies
 * the change as `major`/`minor`/`patch`. It only ever WARNS (the caller never
 * blocks a human-approved adopt — strict-superset floor); the classification +
 * blast radius are what the human sees before the diff.
 *
 * The public surface is three parts (D132): (a) the `governed-by`-linked
 * directives (`linkedDirectives`, the TAX-2 authority surface), (b) the exported
 * Role name, and (c) the asset mount-contract hashes. Removing/changing any =
 * MAJOR; additive = MINOR; anything off the surface (wording, reference Pieces, a
 * pure version-string change) = PATCH.
 *
 * On a MAJOR bump it reports the dependent Roles as the blast radius via an
 * injected, consume-only M1 graph read (the `CompileDeps` port pattern) — keyed
 * by the PRIOR role name, since that is the identity the existing graph edges
 * point at. Absent the port, the blast radius is empty (the floor stays honest
 * rather than guessing). M5 never imports M1.
 *
 * Loosened-severity (a Type-1 link relaxed to Type-2) is NOT yet classified: it
 * needs the linked constraint's strength from the M3 registry, which the manifest
 * does not carry — deferred alongside the other registry-dependent rows.
 */

export type SemverBump = 'major' | 'minor' | 'patch';

/** The injected consume-only M1 graph read (absent ⇒ blast radius empty). */
export interface VersionGateDeps {
  /** D132 blast radius — the Roles whose `depends-on` edges point at this bundle. */
  dependentRoles?: (bundleName: string) => string[];
}

export interface VersionGateResult {
  bump: SemverBump;
  /** The surface changes that drove the classification (most-severe first). */
  reasons: string[];
  /** On a MAJOR bump, the dependent Roles (D132); empty otherwise or with no port. */
  blastRadius: string[];
}

export function versionGate(
  bundle: BundleManifest,
  prior: BundleManifest,
  deps: VersionGateDeps = {},
): VersionGateResult {
  const breaking: string[] = [];
  const additive: string[] = [];

  // (b) exported Role name — a rename breaks every dependent.
  if (bundle.role !== prior.role) {
    breaking.push(`Role renamed "${prior.role}" → "${bundle.role}"`);
  }

  // (a) the governed-by-linked directive surface.
  diffLinks(prior.linkedDirectives, bundle.linkedDirectives, breaking, additive);

  // (c) asset mount-contract hashes.
  diffHashes(prior.assetContractHashes, bundle.assetContractHashes, breaking, additive);

  const bump: SemverBump = breaking.length > 0 ? 'major' : additive.length > 0 ? 'minor' : 'patch';
  const reasons = [...breaking, ...additive];
  const blastRadius = bump === 'major' ? (deps.dependentRoles?.(prior.role) ?? []) : [];

  return { bump, reasons, blastRadius };
}

/** A removed directive or a dropped link is breaking; a new directive or link is additive. */
function diffLinks(
  prior: Record<string, string[]>,
  next: Record<string, string[]>,
  breaking: string[],
  additive: string[],
): void {
  for (const [piece, priorLinks] of Object.entries(prior)) {
    const nextLinks = new Set(next[piece] ?? []);
    const dropped = priorLinks.filter((c) => !nextLinks.has(c));
    if (piece in next) {
      if (dropped.length > 0) {
        breaking.push(`directive "${piece}" dropped governed-by link(s): ${dropped.join(', ')}`);
      }
    } else {
      breaking.push(`directive "${piece}" removed`);
    }
  }
  for (const [piece, nextLinks] of Object.entries(next)) {
    const priorLinks = new Set(prior[piece] ?? []);
    const added = nextLinks.filter((c) => !priorLinks.has(c));
    if (added.length > 0) {
      additive.push(`directive "${piece}" added governed-by link(s): ${added.join(', ')}`);
    }
  }
}

/** A removed or changed asset contract is breaking; a new asset contract is additive. */
function diffHashes(
  prior: Record<string, string>,
  next: Record<string, string>,
  breaking: string[],
  additive: string[],
): void {
  for (const [asset, hash] of Object.entries(prior)) {
    if (!(asset in next)) breaking.push(`asset contract "${asset}" removed`);
    else if (next[asset] !== hash) breaking.push(`asset contract "${asset}" changed`);
  }
  for (const asset of Object.keys(next)) {
    if (!(asset in prior)) additive.push(`asset contract "${asset}" added`);
  }
}
