import { describe, expect, it } from 'vitest';
import { pieceSchema } from '@coa/shared';
import { baselinePieces, type BaselineContext } from './baseline-pieces.js';

const CTX: BaselineContext = {
  platform: 'win32',
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

  it('authors the environment block from the session-invariant facts (platform + date only)', () => {
    const env = baselinePieces(CTX).find((p) => p.name === 'baseline-environment');
    expect(env?.body).toContain('win32');
    expect(env?.body).toContain('2026-07-02');
  });

  it('never puts the worktree path in the compiled prompt (dynamic, backend supplies cwd)', () => {
    const env = baselinePieces({ ...CTX }).find((p) => p.name === 'baseline-environment');
    expect(env?.body).not.toMatch(/working directory/i);
    expect(baselinePieces(CTX).map((p) => p.body).join('\n')).not.toContain('/work/repo');
  });

  it('never names the model in the compiled prompt (cache-stable across model switches)', () => {
    const names = baselinePieces(CTX).map((p) => p.name);
    expect(names).not.toContain('baseline-model');
    // The model id must not leak into any Piece body either.
    expect(baselinePieces(CTX).map((p) => p.body).join('\n')).not.toContain('claude-opus-4-8');
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
