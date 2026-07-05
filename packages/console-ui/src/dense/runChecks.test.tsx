// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseChecks, RunChecks } from './runChecks.js';

describe('parseChecks', () => {
  it('parses a passing summary into per-check results and a flag count', () => {
    expect(parseChecks('typecheck ✓  lint ✓  tests ✓  — 0 flags')).toEqual({
      checks: [
        { name: 'typecheck', ok: true },
        { name: 'lint', ok: true },
        { name: 'tests', ok: true },
      ],
      flags: 0,
    });
  });

  it('parses a mixed summary with failing checks and a non-zero flag count', () => {
    expect(parseChecks('typecheck ✗  lint ✓  tests ✗  — 3 flags')).toEqual({
      checks: [
        { name: 'typecheck', ok: false },
        { name: 'lint', ok: true },
        { name: 'tests', ok: false },
      ],
      flags: 3,
    });
  });

  it('parses without a flags tail (flags undefined)', () => {
    expect(parseChecks('build ✓  lint ✓')).toEqual({
      checks: [
        { name: 'build', ok: true },
        { name: 'lint', ok: true },
      ],
    });
  });

  it('returns undefined when nothing parses, and never throws', () => {
    expect(parseChecks('some freeform text with no marks')).toBeUndefined();
    expect(parseChecks('')).toBeUndefined();
    expect(() => parseChecks('✓✗ garbage')).not.toThrow();
  });
});

describe('RunChecks', () => {
  it('renders a chip per check and a flags chip', () => {
    const { container } = render(<RunChecks output="typecheck ✓  lint ✗  — 2 flags" />);
    expect(container.textContent).toContain('typecheck');
    expect(container.textContent).toContain('lint');
    expect(container.textContent).toContain('2 flags');
  });

  it('falls back to a plain verbatim preview when the output does not parse', () => {
    const { container } = render(<RunChecks output="totally unstructured output" />);
    expect(container.textContent).toContain('totally unstructured output');
  });
});
