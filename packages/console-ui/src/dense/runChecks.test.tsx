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
  it('renders a mark + name per check and a passed/failed footer', () => {
    const { container } = render(<RunChecks output="typecheck ✓  lint ✗  — 2 flags" />);
    expect(container.textContent).toContain('typecheck');
    expect(container.textContent).toContain('lint');
    expect(container.querySelector('[aria-label="passed"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="failed"]')).not.toBeNull();
    expect(container.textContent).toContain('1 passed');
    expect(container.textContent).toContain('1 failed');
  });

  it('renders only the passed count when nothing failed', () => {
    const { container } = render(<RunChecks output="typecheck ✓  lint ✓" />);
    expect(container.textContent).toContain('2 passed');
    expect(container.querySelector('[aria-label="failed"]')).toBeNull();
  });

  it('falls back to a plain verbatim preview when the output does not parse', () => {
    const { container } = render(<RunChecks output="totally unstructured output" />);
    expect(container.textContent).toContain('totally unstructured output');
    const body = container.querySelector('.text-s8');
    expect(body).not.toBeNull();
  });

  it('falls back to the FAILED treatment (crit tint + markErrors) when a failed run has unparseable output', () => {
    const output = 'Fatal error before any checks could run.\n\nExit code: 1';
    const { container } = render(<RunChecks output={output} failed={true} />);
    expect(container.textContent).toContain('Fatal error before any checks could run.');
    const body = container.querySelector('.text-s10');
    expect(body).not.toBeNull();
    expect(body?.className).not.toMatch(/\btext-s8\b/);
    expect(body?.querySelector('.text-crit')?.textContent).toBe('Exit code: 1');
  });
});
