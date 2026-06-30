import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSessionDeps, type BuiltSession } from './session-deps.js';

let dir: string;
let built: BuiltSession | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-cli-'));
  built = undefined;
});
afterEach(() => {
  built?.handle.kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildSessionDeps', () => {
  it('wires the real daemon core and the Claude adapter factory into runnable session deps', () => {
    built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(built.deps.catalogue.length).toBeGreaterThan(0);
    expect(built.deps.gate()).toEqual({ allow: true });
    expect(typeof built.deps.createAdapter).toBe('function');
  });

  it('binds the worktree to the configured root', () => {
    built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(built.deps.bindWorktree('s1', 'src')).toBe(dir);
  });

  it('threads the cost ceiling into the real cap', () => {
    built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir, ceilingUsd: 1 });
    built.deps.charge('s1', { tokensIn: 0, tokensOut: 0, costUsd: 1 });
    expect(built.handle.governance.capState().capHit).toBe(true);
  });
});
