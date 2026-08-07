import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeEventDraft } from '@coa/core';
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

  it('drives the committed generation registry: a drifted target makes the close-gate live', () => {
    mkdirSync(join(dir, '.coa'), { recursive: true });
    writeFileSync(
      join(dir, '.coa', 'generate.yaml'),
      [
        'relations:',
        '  gen:',
        '    source: src/a.ts',
        '    target: gen/a.ts',
        '    lang: typescript',
        '    command: node gen.js',
        "    version: '1'",
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'gen.js'), "process.stdout.write('export const x = 1;');", 'utf8');
    mkdirSync(join(dir, 'gen'), { recursive: true });
    writeFileSync(join(dir, 'gen', 'a.ts'), 'export const x = 2;', 'utf8');

    built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(built.deps.gate()).toEqual({ allow: true });

    const modify: ChangeEventDraft = {
      worktree: 'main',
      actor: 'session',
      op_id: 'op-1',
      provenance: 'declared',
      cause: null,
      kind: 'modify',
      path: 'src/a.ts',
      pre_hash: 'a',
      post_hash: 'b',
      generated: false,
    };
    built.handle.kernel.emit(modify);

    expect(built.deps.gate().allow).toBe(false);
  });
});
