import { describe, expect, it, vi } from 'vitest';
import { createSsotConstraintProducer } from './ssot-constraint.js';
import type { GenerationEntry } from './generate-config.js';
import { createGenerationRunner, type GenerationIo } from './generation-runner.js';

const entry = (over: Partial<GenerationEntry> = {}): GenerationEntry => ({
  name: 'api-types',
  source: 'openapi.yaml',
  target: 'src/api.ts',
  lang: 'typescript',
  command: 'gen-api',
  version: '7.0.0',
  runOn: ['source-change'],
  ...over,
});

const io = (over: Partial<GenerationIo> = {}): GenerationIo => ({
  exec: () => Buffer.from(''),
  readFile: () => Buffer.from(''),
  ...over,
});

describe('createGenerationRunner', () => {
  it('regenerates by running the relation command and decoding its stdout as text', () => {
    const exec = vi.fn(() => Buffer.from('export type T = number;'));
    const runner = createGenerationRunner([entry()], io({ exec }));

    expect(runner.regenerate(entry())).toEqual({ kind: 'text', bytes: 'export type T = number;' });
    expect(exec).toHaveBeenCalledWith('gen-api', expect.anything());
  });

  it('runs the generator in a fixed environment (GEN-8 (c) — locale, TZ, source epoch)', () => {
    const exec = vi.fn(() => Buffer.from('x'));
    createGenerationRunner([entry()], io({ exec })).regenerate(entry());

    const env = exec.mock.calls[0]?.[1] as Record<string, string>;
    expect(env).toMatchObject({ LC_ALL: 'C', LANG: 'C.UTF-8', TZ: 'UTC' });
    expect(env.SOURCE_DATE_EPOCH).toBeDefined();
  });

  it('reports non-canonicalizable binary output (a NUL byte) as binary', () => {
    const exec = vi.fn(() => Buffer.from([0x89, 0x50, 0x00, 0x4e]));
    const runner = createGenerationRunner([entry()], io({ exec }));

    expect(runner.regenerate(entry())).toEqual({ kind: 'binary' });
  });

  it('reads the checked-in target bytes via the injected io port', () => {
    const readFile = vi.fn(() => Buffer.from('checked-in'));
    const runner = createGenerationRunner([entry()], io({ readFile }));

    expect(runner.readTarget(entry())).toBe('checked-in');
    expect(readFile).toHaveBeenCalledWith('src/api.ts');
  });

  it('throws for a relation it was not configured with (defensive misconfiguration guard)', () => {
    const runner = createGenerationRunner([entry()], io());
    expect(() => runner.regenerate(entry({ name: 'unknown' }))).toThrow(/unknown/);
  });

  it('drives a real SSOT-constraint producer end to end: stable generator, drifted target ⇒ Type-1', () => {
    const fresh = 'export type T = number;';
    const runner = createGenerationRunner(
      [entry()],
      io({
        exec: () => Buffer.from(fresh),
        readFile: () => Buffer.from('export type T = string;'),
      }),
    );
    const { producer, degraded } = createSsotConstraintProducer([entry()], runner);

    expect(degraded).toEqual([]);
    const flags = producer.run({ kind: 'scope', scope: 'all' });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.ruleId).toBe('generated-stale:api-types');
    expect(flags[0]?.fix?.diff).toMatchObject({ form: 'whole-file', body: fresh });
  });
});
