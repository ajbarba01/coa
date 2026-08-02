import { describe, expect, it } from 'vitest';
import { diffLines } from './toolDiff.js';

describe('diffLines', () => {
  it('counts a one-line replacement as +1 −1 and classifies each line', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.lines).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('counts pure additions and pure removals', () => {
    expect(diffLines('a', 'a\nb\nc')).toMatchObject({ added: 2, removed: 0 });
    expect(diffLines('a\nb\nc', 'a')).toMatchObject({ added: 0, removed: 2 });
  });

  it('reports no change for identical input', () => {
    const d = diffLines('x\ny', 'x\ny');
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.lines.every((l) => l.kind === 'context')).toBe(true);
  });

  it('preserves bytes verbatim — leading whitespace is not normalized', () => {
    const d = diffLines('  indented', '\tindented');
    expect(d.lines.find((l) => l.kind === 'removed')?.text).toBe('  indented');
    expect(d.lines.find((l) => l.kind === 'added')?.text).toBe('\tindented');
  });

  it('handles empty strings without throwing', () => {
    expect(() => diffLines('', '')).not.toThrow();
    expect(diffLines('', 'new')).toMatchObject({ added: 1, removed: 1 });
  });
});
