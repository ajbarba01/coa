// packages/console-ui/src/dense/ToolCard.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaneOverlayProvider } from '@coa/console-kit';
import { ToolCard } from './ToolCard.js';

const editInput = JSON.stringify({
  file_path: 'src/auth.ts',
  old_string: 'const a = 1;',
  new_string: 'const a = 2;',
});

/** The header is the toggle whenever a body exists — find it by its `aria-expanded`
 *  attribute (the inner path/url link has none, so this is unambiguous). */
function header(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[role="button"][aria-expanded]');
  if (el === null) throw new Error('no toggleable header found');
  return el as HTMLElement;
}

describe('ToolCard', () => {
  it('renders the verb, a clickable path button that fires onOpenPath, and a diff-stat meta', async () => {
    const onOpenPath = vi.fn();
    render(
      <ToolCard tool="Edit" input={editInput} output="ok" ok={true} onOpenPath={onOpenPath} />,
    );
    expect(screen.getByText('Edit')).toBeInTheDocument();
    const pathBtn = screen.getByRole('button', { name: 'src/auth.ts' });
    await userEvent.click(pathBtn);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', undefined);
  });

  it('renders path:line and passes the line to onOpenPath for a Read with an offset', async () => {
    const onOpenPath = vi.fn();
    render(
      <ToolCard
        tool="Read"
        input='{"file_path":"src/auth.ts","offset":12,"limit":40}'
        output="x"
        ok={true}
        onOpenPath={onOpenPath}
      />,
    );
    // The `:line` tail is a separate low-emphasis span, so the computed accessible name
    // joins it with a space even though the two sit flush together visually.
    const pathBtn = screen.getByRole('button', { name: /^src\/auth\.ts\s*:12$/ });
    await userEvent.click(pathBtn);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', 12);
  });

  it('renders the path as plain text (no button) when onOpenPath is omitted', () => {
    render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(screen.queryByRole('button', { name: 'src/auth.ts' })).not.toBeInTheDocument();
    expect(screen.getByText('src/auth.ts')).toBeInTheDocument();
  });

  it('clicking the path link does not toggle the card open/closed', async () => {
    const onOpenPath = vi.fn();
    const { container } = render(
      <ToolCard
        tool="Read"
        input='{"file_path":"src/notes.txt"}'
        output="a\nb"
        ok={true}
        onOpenPath={onOpenPath}
      />,
    );
    const h = header(container);
    expect(h.getAttribute('aria-expanded')).toBe('false');
    const pathBtn = screen.getByRole('button', { name: 'src/notes.txt' });
    await userEvent.click(pathBtn);
    expect(onOpenPath).toHaveBeenCalledWith('src/notes.txt', undefined);
    expect(h.getAttribute('aria-expanded')).toBe('false');
  });

  it('truncates a long command tail and expands it into the pane overlay', async () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    render(
      <PaneOverlayProvider>
        <ToolCard tool="Bash" input='{"command":"seq 30"}' output={output} ok={true} maxLines={5} />
      </PaneOverlayProvider>,
    );
    // Tail-clamped: an early line is hidden, the trailing lines show; the clamp row hands
    // off to the overlay.
    const clamp = screen.getByRole('button', { name: /more lines/i });
    expect(clamp).toBeInTheDocument();
    await userEvent.click(clamp);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('line 0');
  });

  it('renders Grep results as clickable match rows that fire onOpenPath(path, line)', async () => {
    const onOpenPath = vi.fn();
    const { container } = render(
      <ToolCard
        tool="Grep"
        input='{"pattern":"mint"}'
        output={'src/auth.ts:31:  const next = mint(id);\nsrc/session.ts:88'}
        ok={true}
        onOpenPath={onOpenPath}
      />,
    );
    // Grep rests collapsed — open the card via its header toggle.
    await userEvent.click(header(container));
    const row = screen.getByRole('button', { name: /src\/auth\.ts:31/ });
    await userEvent.click(row);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', 31);
    // A Glob-less line with no text still resolves the path + line.
    expect(screen.getByRole('button', { name: /src\/session\.ts:88/ })).toBeInTheDocument();
  });

  it('renders an unparseable search line as plain text (no button)', async () => {
    const { container } = render(
      <ToolCard
        tool="Grep"
        input='{"pattern":"x"}'
        output={'weird line no colon'}
        ok={true}
        onOpenPath={() => {}}
      />,
    );
    await userEvent.click(header(container));
    expect(screen.queryByRole('button', { name: /weird line/ })).not.toBeInTheDocument();
    expect(screen.getByText('weird line no colon')).toBeInTheDocument();
  });

  it('renders a byte-faithful highlighted diff for an edit, tinted with the diff-add/del wash', () => {
    const { container } = render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(container.querySelector('.bg-diff-del\\/12')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('.bg-diff-add\\/12')?.textContent).toContain('const a = 2;');
  });

  it('renders edit_symbol as a diff derived from its search-replace DiffSpec', () => {
    const input = JSON.stringify({
      ref: { path: 'src/auth.ts', symbol: 'mint' },
      diff: { form: 'search-replace', hunks: [{ find: 'const a = 1;', replace: 'const a = 2;' }] },
    });
    const { container } = render(
      <ToolCard tool="edit_symbol" input={input} output="applied" ok={true} />,
    );
    expect(container.querySelector('.bg-diff-del\\/12')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('.bg-diff-add\\/12')?.textContent).toContain('const a = 2;');
  });

  it('marks error tokens in a failing command body, over the whole-body error tint', () => {
    const output =
      'src/auth.ts(31,5): error TS2554: Expected 1 arguments, but got 2.\n\nExit code: 2';
    const { container } = render(
      <ToolCard tool="Bash" input='{"command":"tsc"}' output={output} ok={false} />,
    );
    const marks = [...container.querySelectorAll('.text-crit')].map((n) => n.textContent);
    expect(marks).toContain('error TS2554');
    expect(marks).toContain('Exit code: 2');
    // Byte-faithful: the body still contains the exact source.
    expect(container.textContent).toContain('Expected 1 arguments, but got 2.');
  });

  it('renders get_symbol source as a byte-faithful preview once opened', async () => {
    const src = 'export function mint(id: string): Token {\n  return new Token(id);\n}';
    const { container } = render(
      <ToolCard
        tool="get_symbol"
        input='{"ref":{"path":"src/auth.ts","symbol":"mint"}}'
        output={src}
        ok={true}
      />,
    );
    // Collapsed by default: the body slide is mounted (for the open transition) but marked
    // aria-hidden until the header is opened.
    const h = header(container);
    expect(h.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.grid[aria-hidden="true"]')?.textContent).toContain(
      'return new Token(id);',
    );
    await userEvent.click(h);
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.grid[aria-hidden="true"]')).toBeNull();
    expect(container.textContent).toContain('export function mint(id: string): Token {');
    expect(container.textContent).toContain('return new Token(id);');
  });

  it('surfaces the symbol name in the meta slot', () => {
    render(
      <ToolCard
        tool="get_symbol"
        input='{"ref":{"path":"src/auth.ts","symbol":"mint"}}'
        output="x"
        ok={true}
      />,
    );
    expect(screen.getByText('mint')).toBeInTheDocument();
  });

  it('shows a hunk count in the meta slot for an apply_patch', () => {
    const input = JSON.stringify({
      target: 'src/auth.ts',
      diff: {
        form: 'search-replace',
        hunks: [
          { find: 'a', replace: 'b' },
          { find: 'c', replace: 'd' },
        ],
      },
    });
    render(<ToolCard tool="apply_patch" input={input} output="applied" ok={true} />);
    expect(screen.getByText('2 hunks')).toBeInTheDocument();
  });

  it('shows a failed collapsed tool as an always-visible error body (rests open, never requires opening)', () => {
    const { container } = render(
      <ToolCard
        tool="get_symbol"
        input='{"ref":{"name":"orphan"}}'
        output={'not found: no-symbol'}
        ok={false}
      />,
    );
    expect(screen.getByLabelText(/^failed$/i)).toBeInTheDocument();
    expect(container.textContent).toContain('not found: no-symbol');
    expect(header(container).getAttribute('aria-expanded')).toBe('true');
  });

  it('renders NO body and no toggle for an empty search result (0 matches shows only in the header)', () => {
    const { container } = render(
      <ToolCard tool="Glob" input='{"pattern":"*.zzz"}' output={''} ok={true} />,
    );
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.getByText('Glob')).toBeInTheDocument();
  });

  it('renders WebSearch results as clickable links that fire onOpenUrl', async () => {
    const onOpenUrl = vi.fn();
    const { container } = render(
      <ToolCard
        tool="WebSearch"
        input='{"query":"tokens"}'
        output={'Rotating tokens — https://ex.com/a\nsingle-use\nJWT basics — https://ex.com/b'}
        ok={true}
        onOpenUrl={onOpenUrl}
      />,
    );
    await userEvent.click(header(container));
    const link = screen.getByRole('button', { name: /Rotating tokens/ });
    await userEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledWith('https://ex.com/a');
    expect(screen.getByRole('button', { name: /JWT basics/ })).toBeInTheDocument();
  });

  it('renders the WebFetch source url as a clickable link in the header, and rests collapsed as a quiet receipt', async () => {
    const onOpenUrl = vi.fn();
    const { container } = render(
      <ToolCard
        tool="WebFetch"
        input='{"url":"https://ex.com/page","prompt":"summarize"}'
        output={'# Page\n\nbody'}
        ok={true}
        onOpenUrl={onOpenUrl}
      />,
    );
    const link = screen.getByRole('button', { name: 'https://ex.com/page' });
    await userEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledWith('https://ex.com/page');
    // WebFetch rests collapsed — a quiet one-line receipt at rest, same as Read/Grep.
    expect(header(container).getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the WebFetch fetched content as a real body, reachable when expanded (maintainer override of the proto no-body caption)', async () => {
    const { container } = render(
      <ToolCard
        tool="WebFetch"
        input='{"url":"https://ex.com/page","prompt":"summarize"}'
        output={'# Page heading\n\ndigested body text'}
        ok={true}
      />,
    );
    const h = header(container);
    expect(h.getAttribute('aria-expanded')).toBe('false');
    // Mounted-but-hidden while collapsed (matches the Read/Grep resting-collapse pattern).
    expect(container.querySelector('.grid[aria-hidden="true"]')?.textContent).toContain(
      'digested body text',
    );
    await userEvent.click(h);
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('# Page heading');
    expect(container.textContent).toContain('digested body text');
  });
});

describe('state vocabulary — the indicator law', () => {
  it('renders the green succeeded dot on success', () => {
    const { container } = render(
      <ToolCard tool="Bash" input='{"command":"ls"}' output="ok" ok={true} />,
    );
    const dot = container.querySelector('[aria-label="succeeded" i]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toMatch(/bg-ok\b/);
  });

  it('renders the blue running dot while the call is in flight', () => {
    const { container } = render(<ToolCard tool="Bash" input='{"command":"ls"}' />);
    const dot = container.querySelector('[aria-label="running" i]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toMatch(/bg-run\b/);
  });

  it('renders the red failure dot on a failed call', () => {
    const { container } = render(
      <ToolCard tool="Bash" input='{"command":"ls"}' output="boom" ok={false} />,
    );
    const dot = container.querySelector('[aria-label="failed" i]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toMatch(/bg-crit\b/);
  });

  it('renders exactly one status dot per call, in the one slot', () => {
    for (const props of [
      { output: undefined, ok: undefined },
      { output: 'ok', ok: true },
      { output: 'boom', ok: false },
    ]) {
      const { container, unmount } = render(
        <ToolCard tool="Bash" input='{"command":"ls"}' {...props} />,
      );
      expect(
        container.querySelectorAll(
          '[aria-label="running" i], [aria-label="succeeded" i], [aria-label="failed" i]',
        ),
      ).toHaveLength(1);
      unmount();
    }
  });

  it('renders no body at all while running (the dot is the only live emphasis)', () => {
    const { container } = render(<ToolCard tool="Read" input='{"file_path":"src/notes.txt"}' />);
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });
});

describe('resting rule', () => {
  it('rests a Read collapsed by default', () => {
    const { container } = render(
      <ToolCard tool="Read" input='{"file_path":"src/notes.txt"}' output="a\nb" ok={true} />,
    );
    expect(header(container).getAttribute('aria-expanded')).toBe('false');
  });

  it('rests an Edit open by default', () => {
    const { container } = render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(header(container).getAttribute('aria-expanded')).toBe('true');
  });

  it('rests a Bash command open by default', () => {
    const { container } = render(
      <ToolCard tool="Bash" input='{"command":"ls"}' output="a" ok={true} />,
    );
    expect(header(container).getAttribute('aria-expanded')).toBe('true');
  });

  it('rests run_checks open by default', () => {
    const { container } = render(
      <ToolCard tool="run_checks" input='{"scope":"all"}' output="a ✓" ok={true} />,
    );
    expect(header(container).getAttribute('aria-expanded')).toBe('true');
  });

  it('rests a failed call open by default, even for an otherwise-collapsed tool', () => {
    const { container } = render(
      <ToolCard tool="Read" input='{"file_path":"src/notes.txt"}' output="boom" ok={false} />,
    );
    expect(header(container).getAttribute('aria-expanded')).toBe('true');
  });

  it('rests a read/search tool collapsed (aria-hidden) until its header is opened', async () => {
    const { container } = render(
      <ToolCard
        tool="Read"
        input='{"file_path":"src/notes.txt"}'
        output={'first line\nsecond line\nthird line'}
        ok={true}
      />,
    );
    const h = header(container);
    expect(h.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.grid[aria-hidden="true"]')?.textContent).toContain(
      'second line',
    );
    await userEvent.click(h);
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.grid[aria-hidden="true"]')).toBeNull();
    expect(screen.getByText('second line')).toBeInTheDocument();
  });
});

describe('the header is byte-identical open and closed', () => {
  it('keeps the header content present and only aria-expanded flips', async () => {
    const { container } = render(
      <ToolCard tool="Read" input='{"file_path":"src/notes.txt"}' output="a\nb" ok={true} />,
    );
    const h = header(container);
    expect(h.textContent).toContain('Read');
    expect(h.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(h);
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(h.textContent).toContain('Read');
  });
});

describe('clamp direction', () => {
  it('clamps command output from the END, with the clamp row ABOVE the body', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line-${i}`);
    const { container } = render(
      <ToolCard
        tool="Bash"
        input='{"command":"seq 12"}'
        output={lines.join('\n')}
        ok={true}
        maxLines={5}
      />,
    );
    const bodyWrap = container.querySelector('.border-t.border-s3');
    expect(bodyWrap?.firstElementChild?.tagName).toBe('BUTTON'); // the clamp row leads
    expect(bodyWrap?.lastElementChild?.textContent).toContain('line-11');
    expect(container.textContent).not.toContain('line-0');
    expect(screen.getByRole('button', { name: /7 more lines/ })).toBeInTheDocument();
  });

  it('clamps a diff from the START, with the clamp row BELOW the body', () => {
    const before = Array.from({ length: 10 }, (_, i) => `old-${i}`).join('\n');
    const after = Array.from({ length: 10 }, (_, i) => `new-${i}`).join('\n');
    const input = JSON.stringify({
      file_path: 'src/big.ts',
      old_string: before,
      new_string: after,
    });
    const { container } = render(
      <ToolCard tool="Edit" input={input} output="ok" ok={true} maxLines={5} />,
    );
    const bodyWrap = container.querySelector('.border-t.border-s3');
    expect(bodyWrap?.lastElementChild?.tagName).toBe('BUTTON'); // the clamp row trails
    expect(screen.getByRole('button', { name: /more line/ })).toBeInTheDocument();
    expect(screen.queryByText(/new-9/)).not.toBeInTheDocument();
  });

  it('clamps a long Bash command tail from the END, with the clamp row ABOVE the body', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `bash-${i}`);
    const { container } = render(
      <ToolCard
        tool="Bash"
        input='{"command":"seq 12"}'
        output={lines.join('\n')}
        ok={true}
        maxLines={8}
      />,
    );
    const bodyWrap = container.querySelector('.border-t.border-s3');
    expect(bodyWrap?.firstElementChild?.tagName).toBe('BUTTON'); // the clamp row leads
    // The tail is visible at rest (the verdict lives at the end); the head is hidden.
    expect(container.textContent).toContain('bash-11');
    expect(screen.queryByText('bash-0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4 more lines/ })).toBeInTheDocument();
  });

  it('clamps a long WebFetch digest from the START, with the clamp row BELOW the body (the inverse of Bash)', async () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? '# Page heading' : `body line ${i}`,
    );
    const { container } = render(
      <ToolCard
        tool="WebFetch"
        input='{"url":"https://ex.com/page","prompt":"summarize"}'
        output={lines.join('\n')}
        ok={true}
        maxLines={8}
      />,
    );
    // WebFetch rests collapsed — open it via the header toggle.
    await userEvent.click(header(container));
    const bodyWrap = container.querySelector('.border-t.border-s3');
    expect(bodyWrap?.lastElementChild?.tagName).toBe('BUTTON'); // the clamp row trails
    // The FIRST lines (title/lead) are visible at rest; the LAST lines are hidden.
    expect(container.textContent).toContain('# Page heading');
    expect(container.textContent).toContain('body line 7');
    expect(container.textContent).not.toContain('body line 11');
    expect(screen.getByRole('button', { name: /4 more lines/ })).toBeInTheDocument();
  });
});

describe('diff line tokenization', () => {
  it('washes an added line while its code still tokenizes into syntax spans', () => {
    const input = JSON.stringify({
      file_path: 'src/auth.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });
    const { container } = render(<ToolCard tool="Edit" input={input} output="ok" ok={true} />);
    const added = container.querySelector('.bg-diff-add\\/12');
    expect(added).not.toBeNull();
    // one marker span + multiple highlighted code spans.
    expect(added?.querySelectorAll('span').length).toBeGreaterThan(2);
  });
});

describe('checks body', () => {
  it('renders the N passed · M failed footer', () => {
    render(
      <ToolCard
        tool="run_checks"
        input='{"scope":"all"}'
        output="typecheck ✓  lint ✗"
        ok={false}
      />,
    );
    expect(screen.getByText(/1 passed/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('applies the failed error treatment (not neutral success styling) when a failed run_checks output parses to zero checks', () => {
    const output = 'TypeError: crash before any check reported\n\nExit code: 1';
    const { container } = render(
      <ToolCard tool="run_checks" input='{"scope":"all"}' output={output} ok={false} />,
    );
    expect(screen.getByLabelText(/^failed$/i)).toBeInTheDocument();
    const body = container.querySelector('.text-s10');
    expect(body).not.toBeNull();
    expect(body?.className).not.toMatch(/\btext-s8\b/);
    expect(body?.textContent).toContain('TypeError: crash before any check reported');
    expect(body?.querySelector('.text-crit')?.textContent).toBe('Exit code: 1');
  });
});
