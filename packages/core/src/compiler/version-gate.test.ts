import type { BundleManifest } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { versionGate, type VersionGateDeps } from './version-gate.js';

function manifest(over: Partial<BundleManifest> = {}): BundleManifest {
  return {
    role: 'reviewer',
    pieces: ['style', 'no-any'],
    frame: { allow: [], deny: [] },
    linkedDirectives: { 'no-any': ['ts-strict'] },
    assetContractHashes: { 'rules.md': 'h1' },
    version: '1.0.0',
    ...over,
  };
}

describe('versionGate — D132 SemVer bump classification over the declared public surface', () => {
  it('classifies a wording-only change (nothing on the public surface moved) as PATCH', () => {
    const prior = manifest();
    const next = manifest({ version: '1.0.1', pieces: ['style', 'no-any', 'extra-reference'] });

    const result = versionGate(next, prior);

    expect(result.bump).toBe('patch');
    expect(result.blastRadius).toEqual([]);
  });

  it('classifies an added linked directive as MINOR (additive)', () => {
    const prior = manifest();
    const next = manifest({ linkedDirectives: { 'no-any': ['ts-strict'], style: ['prettier'] } });

    expect(versionGate(next, prior).bump).toBe('minor');
  });

  it('classifies an added asset contract as MINOR (additive)', () => {
    const prior = manifest();
    const next = manifest({ assetContractHashes: { 'rules.md': 'h1', 'extra.md': 'h2' } });

    expect(versionGate(next, prior).bump).toBe('minor');
  });

  it('classifies a dropped governed-by link as MAJOR (breaking)', () => {
    const prior = manifest({ linkedDirectives: { 'no-any': ['ts-strict', 'lint'] } });
    const next = manifest({ linkedDirectives: { 'no-any': ['ts-strict'] } });

    const result = versionGate(next, prior);

    expect(result.bump).toBe('major');
    expect(result.reasons.join(' ')).toContain('no-any');
  });

  it('classifies a removed directive as MAJOR (breaking)', () => {
    const prior = manifest();
    const next = manifest({ linkedDirectives: {} });

    expect(versionGate(next, prior).bump).toBe('major');
  });

  it('classifies a changed asset-contract hash as MAJOR (breaking)', () => {
    const prior = manifest();
    const next = manifest({ assetContractHashes: { 'rules.md': 'h2' } });

    expect(versionGate(next, prior).bump).toBe('major');
  });

  it('classifies a removed asset contract as MAJOR (breaking)', () => {
    const prior = manifest();
    const next = manifest({ assetContractHashes: {} });

    expect(versionGate(next, prior).bump).toBe('major');
  });

  it('classifies a Role rename as MAJOR (breaking)', () => {
    const prior = manifest({ role: 'reviewer' });
    const next = manifest({ role: 'auditor' });

    expect(versionGate(next, prior).bump).toBe('major');
  });

  it('reports the dependent Roles as the blast radius on a MAJOR bump, keyed by the prior identity', () => {
    const prior = manifest({ role: 'reviewer', linkedDirectives: { 'no-any': ['ts-strict'] } });
    const next = manifest({ role: 'reviewer', linkedDirectives: {} });
    const deps: VersionGateDeps = {
      dependentRoles: (name) => (name === 'reviewer' ? ['tdd-implementer', 'pr-author'] : []),
    };

    expect(versionGate(next, prior, deps).blastRadius).toEqual(['tdd-implementer', 'pr-author']);
  });

  it('keys the blast radius by the PRIOR role name on a rename (the identity dependents point at)', () => {
    const prior = manifest({ role: 'reviewer' });
    const next = manifest({ role: 'auditor' });
    const deps: VersionGateDeps = {
      dependentRoles: (name) => (name === 'reviewer' ? ['tdd-implementer'] : []),
    };

    expect(versionGate(next, prior, deps).blastRadius).toEqual(['tdd-implementer']);
  });

  it('leaves the blast radius empty on a non-MAJOR bump even when the port is injected', () => {
    const prior = manifest();
    const next = manifest({ linkedDirectives: { 'no-any': ['ts-strict'], style: ['prettier'] } });
    const deps: VersionGateDeps = { dependentRoles: () => ['tdd-implementer'] };

    expect(versionGate(next, prior, deps).blastRadius).toEqual([]);
  });

  it('leaves the blast radius empty when no graph port is injected (floor stays honest)', () => {
    const prior = manifest();
    const next = manifest({ role: 'auditor' });

    expect(versionGate(next, prior).blastRadius).toEqual([]);
  });

  it('prefers MAJOR when a change both drops and adds surface', () => {
    const prior = manifest({ linkedDirectives: { 'no-any': ['ts-strict'] } });
    const next = manifest({ linkedDirectives: { style: ['prettier'] } });

    expect(versionGate(next, prior).bump).toBe('major');
  });

  it('is pure — identical inputs yield identical results', () => {
    const prior = manifest();
    const next = manifest({ assetContractHashes: { 'rules.md': 'h2' } });

    expect(versionGate(next, prior)).toEqual(versionGate(next, prior));
  });
});
