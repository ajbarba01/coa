import { describe, expect, it } from 'vitest';
import { pieceSchema } from '@coa/shared';
import { baselinePieces, type BaselineContext } from './baseline-pieces.js';

const CTX: BaselineContext = {
  worktree: '/work/repo',
  platform: 'win32',
  model: 'claude-opus-4-8',
  date: '2026-07-02',
};

describe('baselinePieces', () => {
  it('emits valid Pieces that are all pushed + authored (they shape the prompt)', () => {
    const pieces = baselinePieces(CTX);
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    for (const piece of pieces) {
      expect(pieceSchema.safeParse(piece).success).toBe(true);
      expect(piece.axes.delivery).toBe('push');
      expect(piece.axes.provenance).toBe('authored');
    }
  });

  it('orders the volatile environment Piece last so the stable prefix stays cache-warm', () => {
    const pieces = baselinePieces(CTX);
    expect(pieces[pieces.length - 1]?.name).toBe('baseline-environment');
    // Nothing before it is the environment (single volatile block, at the tail).
    expect(pieces.slice(0, -1).some((p) => p.name === 'baseline-environment')).toBe(false);
  });

  it('authors the environment block from the session facts (model is its own Piece)', () => {
    const env = baselinePieces(CTX).find((p) => p.name === 'baseline-environment');
    expect(env?.body).toContain('/work/repo');
    expect(env?.body).toContain('win32');
    expect(env?.body).toContain('2026-07-02');
    expect(env?.body).not.toContain('claude-opus-4-8');
  });

  it('gives the agent a dedicated Piece telling it which model it runs as', () => {
    const model = baselinePieces(CTX).find((p) => p.name === 'baseline-model');
    expect(model?.body).toContain('claude-opus-4-8');
    // Volatile → lives in the tail, never in the stable prefix.
    const names = baselinePieces(CTX).map((p) => p.name);
    expect(names.indexOf('baseline-model')).toBeGreaterThan(names.indexOf('baseline-code-quality'));
  });

  it('omits the model Piece when the model is unknown (can’t truthfully name it)', () => {
    const { model: _model, ...noModel } = CTX;
    const names = baselinePieces(noModel).map((p) => p.name);
    expect(names).not.toContain('baseline-model');
    expect(names).toContain('baseline-environment');
  });

  it('is byte-stable for identical input (no prompt-cache self-bust)', () => {
    expect(baselinePieces(CTX)).toEqual(baselinePieces(CTX));
  });

  it('uses a coa-neutral identity — never impersonates Claude Code', () => {
    const identity = baselinePieces(CTX).find((p) => p.name === 'baseline-identity');
    expect(identity?.body).not.toMatch(/claude code/i);
    expect(identity?.body).toMatch(/coa governance/i);
  });
});
