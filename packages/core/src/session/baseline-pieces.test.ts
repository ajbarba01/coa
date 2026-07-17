import { describe, expect, it } from 'vitest';
import { pieceSchema } from '@coa/shared';
import { baselinePieces, type BaselineContext } from './baseline-pieces.js';

const CTX: BaselineContext = {
  platform: 'win32',
  shell: 'Git Bash (POSIX sh)',
  date: '2026-07-02',
  model: { provider: 'claude' },
};

describe('baselinePieces', () => {
  it('emits valid Pieces that are all pushed + authored (they shape the prompt)', () => {
    const pieces = baselinePieces(CTX);
    expect(pieces.length).toBeGreaterThanOrEqual(4);
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

  it('authors the environment block from the session-invariant facts (platform + shell + date)', () => {
    const env = baselinePieces(CTX).find((p) => p.name === 'baseline-environment');
    expect(env?.body).toContain('win32');
    expect(env?.body).toContain('Git Bash (POSIX sh)');
    expect(env?.body).toContain('2026-07-02');
  });

  it('never puts the worktree path in the compiled prompt (dynamic, backend supplies cwd)', () => {
    const env = baselinePieces({ ...CTX }).find((p) => p.name === 'baseline-environment');
    expect(env?.body).not.toMatch(/working directory/i);
    expect(
      baselinePieces(CTX)
        .map((p) => p.body)
        .join('\n'),
    ).not.toContain('/work/repo');
  });

  it('names the running model in its own Model slot (so the agent knows what it is)', () => {
    const model = baselinePieces({
      ...CTX,
      model: { provider: 'claude', model: 'claude-opus-4' },
    }).find((p) => p.name === 'baseline-model');
    expect(model?.slot).toBe('model');
    expect(model?.body).toBe('You are running as claude/claude-opus-4');
  });

  it('appends the reasoning effort when one is set', () => {
    const model = baselinePieces({
      ...CTX,
      model: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'max' },
    }).find((p) => p.name === 'baseline-model');
    expect(model?.body).toBe('You are running as deepseek/deepseek-v4-pro (max)');
  });

  it('names just the provider when the model id is unknown', () => {
    const model = baselinePieces({ ...CTX, model: { provider: 'claude' } }).find(
      (p) => p.name === 'baseline-model',
    );
    expect(model?.body).toBe('You are running as claude');
  });

  it('is byte-stable for identical input (no prompt-cache self-bust)', () => {
    expect(baselinePieces(CTX)).toEqual(baselinePieces(CTX));
  });

  it('uses a coa-neutral identity — never impersonates Claude Code', () => {
    const identity = baselinePieces(CTX).find((p) => p.name === 'baseline-identity');
    expect(identity?.body).not.toMatch(/claude code/i);
    expect(identity?.body).toMatch(/governance layer/i);
  });

  it('carries no coa-added safety/refusal guardrail (governance surfaces it, not the prompt)', () => {
    const pieces = baselinePieces(CTX);
    expect(pieces.some((p) => p.name === 'baseline-safety')).toBe(false);
    const bodies = pieces.map((p) => p.body).join('\n');
    expect(bodies).not.toMatch(/refuse|refusal|malicious/i);
  });

  it('assigns every baseline piece a DC-6 slot', () => {
    for (const piece of baselinePieces(CTX)) expect(piece.slot).toBeDefined();
  });

  it('carries a concise tone piece in the tone slot', () => {
    const tone = baselinePieces(CTX).find((p) => p.name === 'baseline-tone');
    expect(tone?.slot).toBe('tone');
  });

  it('keeps the baseline universal — no task-specific code-editing conduct', () => {
    expect(baselinePieces(CTX).some((p) => p.name === 'baseline-code-quality')).toBe(false);
  });
});
