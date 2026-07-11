// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { markErrors } from './errorMarks.js';

function textOf(node: React.ReactNode): string {
  const { container } = render(<>{node}</>);
  return container.textContent ?? '';
}

describe('markErrors — marking', () => {
  it('wraps a TS error code in a crit span', () => {
    const src = 'src/auth.ts(31,5): error TS2554: Expected 1 arguments, but got 2.';
    const { container } = render(<>{markErrors(src)}</>);
    const mark = container.querySelector('.text-crit');
    expect(mark?.textContent).toBe('error TS2554');
  });

  it('wraps an exit code', () => {
    const { container } = render(<>{markErrors('Exit code: 2')}</>);
    expect(container.querySelector('.text-crit')?.textContent).toBe('Exit code: 2');
  });

  it('wraps a leading error: prefix', () => {
    const { container } = render(<>{markErrors('error: something broke')}</>);
    expect(container.querySelector('.text-crit')?.textContent).toBe('error:');
  });

  it('marks multiple markers in one string', () => {
    const { container } = render(<>{markErrors('error TS1 and later Exit code: 7')}</>);
    const marks = [...container.querySelectorAll('.text-crit')].map((n) => n.textContent);
    expect(marks).toEqual(['error TS1', 'Exit code: 7']);
  });
});

describe('markErrors — byte-faithfulness', () => {
  it('preserves the exact source text (textContent === input) when marking', () => {
    const src = 'src/auth.ts(31,5): error TS2554: got 2.\n\nExit code: 2';
    expect(textOf(markErrors(src))).toBe(src);
  });

  it('leaves non-error text untouched and byte-faithful', () => {
    const src = 'all good here, no markers at all';
    const { container } = render(<>{markErrors(src)}</>);
    expect(container.querySelector('.text-crit')).toBeNull();
    expect(container.textContent).toBe(src);
  });

  it('never throws on empty input', () => {
    expect(() => markErrors('')).not.toThrow();
    expect(textOf(markErrors(''))).toBe('');
  });
});
