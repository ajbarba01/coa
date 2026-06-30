import { describe, expect, it } from 'vitest';
import { metricSampleSchema, type MetricSample } from '@coa/shared';
import { parse, type SourceFile } from './parser.js';
import type { CST } from '@coa/shared';
import { extractMetrics } from './extract-metrics.js';

const cstOf = (file: SourceFile): CST => {
  const r = parse(file);
  if ('ok' in r && r.ok === false) throw new Error('parse failed');
  return r;
};

const cc = (src: string): number => {
  const samples = extractMetrics(cstOf({ lang: 'typescript', bytes: src }));
  const sample = samples.find((s) => s.metric === 'cognitive-complexity');
  if (!sample) throw new Error('no cognitive-complexity sample');
  return sample.value;
};

describe('extractMetrics cognitive complexity', () => {
  it('scores a straight-line function at 0', () => {
    expect(cc('function f(x: number): number { return x + 1; }')).toBe(0);
  });

  it('scores one increment per simple branch', () => {
    expect(cc('function f(a: boolean) { if (a) { return 1; } return 0; }')).toBe(1);
  });

  it('adds a nesting penalty for nested branches', () => {
    expect(
      cc('function f(a: boolean, b: boolean) { if (a) { if (b) { return 1; } } return 0; }'),
    ).toBe(3);
  });

  it('counts an else as a flat increment', () => {
    expect(cc('function f(a: boolean) { if (a) { return 1; } else { return 2; } }')).toBe(2);
  });

  it('counts each boolean-operator sequence in a condition', () => {
    // if (+1) + (a && b) sequence (+1) + (|| c) alternation (+1) = 3
    expect(
      cc(
        'function f(a: boolean, b: boolean, c: boolean) { if (a && b || c) { return 1; } return 0; }',
      ),
    ).toBe(3);
  });

  it('penalizes a loop and its nested branch', () => {
    // for (+1) + nested if (+1+1) = 3
    expect(
      cc(
        'function f(n: number) { for (let i = 0; i < n; i++) { if (i % 2) { return i; } } return 0; }',
      ),
    ).toBe(3);
  });
});

describe('extractMetrics samples', () => {
  it('emits schema-valid per-function ast samples with the size-loc confound', () => {
    const samples = extractMetrics(
      cstOf({
        lang: 'typescript',
        bytes: 'function f(a: boolean) {\n  if (a) {\n    return 1;\n  }\n}',
      }),
    );
    for (const s of samples) expect(metricSampleSchema.parse(s)).toBeTruthy();
    const ccSample = samples.find((s) => s.metric === 'cognitive-complexity') as MetricSample;
    expect(ccSample.basis).toBe('ast');
    expect(ccSample.granularity).toBe('symbol');
    expect(ccSample.confidence).toBe('high');
    expect(ccSample.sizeLoc).toBe(5); // the function spans 5 lines
    const sizeSample = samples.find((s) => s.metric === 'size-loc') as MetricSample;
    expect(sizeSample.value).toBe(5);
  });

  it('degrades to a file-level size-loc floor for an ungrammared CST', () => {
    const samples = extractMetrics(
      cstOf({ lang: 'plain', bytes: 'line one\nline two\nline three\n' }),
    );
    expect(samples).toHaveLength(1);
    const only = samples[0] as MetricSample;
    expect(only.metric).toBe('size-loc');
    expect(only.granularity).toBe('file');
    expect(only.value).toBe(4); // three lines + the trailing newline's empty line
    expect(only.confidence).toBe('low');
  });
});
