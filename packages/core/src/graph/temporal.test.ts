import { describe, expect, it } from 'vitest';
import { temporal, type FileTouch } from './temporal.js';

const touch = (seq: number, path: string, ts: string): FileTouch => ({ seq, path, ts });

const history: FileTouch[] = [
  touch(0, 'a.ts', 't1'),
  touch(1, 'b.ts', 't1'),
  touch(2, 'a.ts', 't2'),
  touch(3, 'c.ts', 't2'),
  touch(4, 'a.ts', 't3'),
];

describe('temporal (WAL⨝structure)', () => {
  it('counts churn — how often a node changed', () => {
    expect(temporal('a.ts', history).churn).toBe(3);
    expect(temporal('b.ts', history).churn).toBe(1);
  });

  it('computes a hotspot as churn × complexity (degrades to churn when complexity is unknown)', () => {
    expect(temporal('a.ts', history, { complexity: 5 }).hotspot).toBe(15);
    expect(temporal('a.ts', history).hotspot).toBe(3);
  });

  it('finds change-coupling — nodes that co-change in the same change set', () => {
    const coupling = temporal('a.ts', history).changeCoupling;
    expect(coupling).toEqual([
      { node: 'b.ts', count: 1 },
      { node: 'c.ts', count: 1 },
    ]);
  });

  it('honors a seq window', () => {
    const recent = temporal('a.ts', history, { fromSeq: 2 });
    expect(recent.churn).toBe(2); // seq 2 and 4 only
    expect(recent.changeCoupling).toEqual([{ node: 'c.ts', count: 1 }]);
  });
});
