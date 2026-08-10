import { describe, expect, it } from 'vitest';
import { skillToPiece } from './skill-piece.js';

describe('skillToPiece', () => {
  const skill = {
    name: 'commits',
    description: 'commit conventions',
    body: '# Commits\n',
  };

  it('maps auto delivery to a push Piece and disclosure to pull', () => {
    expect(skillToPiece(skill, 'auto').axes.delivery).toBe('push');
    expect(skillToPiece(skill, 'disclosure').axes.delivery).toBe('pull');
  });

  it('lifts disable-model-invocation onto manualOnly while keeping ccKeys verbatim', () => {
    const piece = skillToPiece(
      { ...skill, ccKeys: { 'disable-model-invocation': true, license: 'MIT' } },
      'auto',
    );
    expect(piece.axes.manualOnly).toBe(true);
    expect(piece.ccKeys).toEqual({ 'disable-model-invocation': true, license: 'MIT' });
  });

  it('is authored provenance with no reminder cadence', () => {
    const piece = skillToPiece(skill, 'auto');
    expect(piece.axes.provenance).toBe('authored');
    expect(piece.axes.salience).toBe('never');
  });
});
