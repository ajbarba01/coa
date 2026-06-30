import { capabilityProfileSchema } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { barebonesProfile, REFS_NULL_FALLBACK } from './null-fallback.js';

describe('the D109 null-fallback contracts', () => {
  it('barebonesProfile is a valid M0 CapabilityProfile', () => {
    expect(() => capabilityProfileSchema.parse(barebonesProfile)).not.toThrow();
  });

  it('marks the refs (LSP) port absent, degrading to the M2 tree-sitter floor', () => {
    expect(barebonesProfile.ports['refs']).toEqual({
      present: false,
      nullFallback: 'M2 tree-sitter floor',
    });
  });

  it('REFS_NULL_FALLBACK is null (the caller degrades to the M2 floor on null)', () => {
    expect(REFS_NULL_FALLBACK).toBeNull();
  });
});
