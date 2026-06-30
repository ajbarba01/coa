import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerationIo } from '@coa/core';
import { buildGenerationProducers, nodeGenerationIo } from './generation.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-gen-cli-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeRegistry = (body: string): void => {
  mkdirSync(join(dir, '.coa'), { recursive: true });
  writeFileSync(join(dir, '.coa', 'generate.yaml'), body, 'utf8');
};

const RELATION = [
  'relations:',
  '  gen:',
  '    source: src/a.ts',
  '    target: gen/a.ts',
  '    lang: typescript',
  '    command: node gen.js',
  "    version: '1'",
].join('\n');

describe('buildGenerationProducers', () => {
  it('yields no producers when no registry is committed', () => {
    expect(buildGenerationProducers(dir)).toEqual([]);
  });

  it('assembles the SSOT-constraint producer from a committed registry', () => {
    writeRegistry(RELATION);
    const io: GenerationIo = {
      exec: () => Buffer.from('export const x = 1;'),
      readFile: () => Buffer.from('export const x = 1;'),
    };
    expect(buildGenerationProducers(dir, io).map((p) => p.id)).toEqual(['ssot-constraint']);
  });

  it('fires a Type-1 when the committed target drifts from the regenerated source', () => {
    writeRegistry(RELATION);
    const io: GenerationIo = {
      exec: () => Buffer.from('export const x = 1;'),
      readFile: () => Buffer.from('export const x = 2;'),
    };
    const flags = buildGenerationProducers(dir, io)[0]?.run({ kind: 'scope', scope: 'all' }) ?? [];
    expect(flags[0]?.ruleId).toBe('generated-stale:gen');
  });

  it('runs a real generator through nodeGenerationIo and detects drift', () => {
    writeRegistry(RELATION);
    writeFileSync(join(dir, 'gen.js'), "process.stdout.write('export const x = 1;');", 'utf8');
    mkdirSync(join(dir, 'gen'), { recursive: true });
    writeFileSync(join(dir, 'gen', 'a.ts'), 'export const x = 2;', 'utf8');

    const flags = buildGenerationProducers(dir, nodeGenerationIo(dir))[0]?.run({
      kind: 'scope',
      scope: 'all',
    });
    expect(flags?.[0]?.ruleId).toBe('generated-stale:gen');
  });
});
