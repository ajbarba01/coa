// packages/console-ui/src/dense/ToolCard.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaneOverlayProvider } from '../layout/PaneOverlay.js';
import { ToolCard } from './ToolCard.js';

const editInput = JSON.stringify({
  file_path: 'src/auth.ts',
  old_string: 'const a = 1;',
  new_string: 'const a = 2;',
});

describe('ToolCard', () => {
  it('renders the verb, a clickable path button that fires onOpenPath, tokens and status', async () => {
    const onOpenPath = vi.fn();
    render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} onOpenPath={onOpenPath} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    const pathBtn = screen.getByRole('button', { name: 'src/auth.ts' });
    await userEvent.click(pathBtn);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', undefined);
    expect(screen.getByText(/≈ .* tok/)).toBeInTheDocument();
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
    const pathBtn = screen.getByRole('button', { name: 'src/auth.ts:12' });
    await userEvent.click(pathBtn);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', 12);
  });

  it('renders the path as plain text (no button) when onOpenPath is omitted', () => {
    render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(screen.queryByRole('button', { name: 'src/auth.ts' })).not.toBeInTheDocument();
    expect(screen.getByText('src/auth.ts')).toBeInTheDocument();
  });

  it('truncates a long body and expands it into the pane overlay', async () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    render(
      <PaneOverlayProvider>
        <ToolCard tool="Bash" input='{"command":"seq 30"}' output={output} ok={true} maxLines={5} />
      </PaneOverlayProvider>,
    );
    // Clamped: an early line is hidden by the tail clamp; the Expand affordance shows the hidden count.
    const expand = screen.getByRole('button', { name: /expand|more/i });
    expect(expand).toBeInTheDocument();
    await userEvent.click(expand);
    // The overlay (role=dialog) now holds the full body — line 0 is present there.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('line 0');
  });

  it('renders Grep results as clickable match rows that fire onOpenPath(path, line)', async () => {
    const onOpenPath = vi.fn();
    render(
      <ToolCard
        tool="Grep"
        input='{"pattern":"mint"}'
        output={'src/auth.ts:31:  const next = mint(id);\nsrc/session.ts:88'}
        ok={true}
        onOpenPath={onOpenPath}
      />,
    );
    // Grep is collapsed by default; expand (no provider ⇒ inline) to reveal the match rows.
    await userEvent.click(screen.getByRole('button', { name: /expand/i }));
    const row = screen.getByRole('button', { name: /src\/auth\.ts:31/ });
    await userEvent.click(row);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', 31);
    // A Glob-less line with no text still resolves the path + line.
    expect(screen.getByRole('button', { name: /src\/session\.ts:88/ })).toBeInTheDocument();
  });

  it('renders an unparseable search line as plain text (no button)', async () => {
    render(<ToolCard tool="Grep" input='{"pattern":"x"}' output={'weird line no colon'} ok={true} onOpenPath={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(screen.queryByRole('button', { name: /weird line/ })).not.toBeInTheDocument();
    expect(screen.getByText('weird line no colon')).toBeInTheDocument();
  });

  it('renders a byte-faithful highlighted diff for an edit', () => {
    const { container } = render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(container.querySelector('.bg-danger-tint')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('.bg-success-tint')?.textContent).toContain('const a = 2;');
  });

  it('renders edit_symbol as a diff derived from its search-replace DiffSpec', () => {
    const input = JSON.stringify({
      ref: { path: 'src/auth.ts', symbol: 'mint' },
      diff: { form: 'search-replace', hunks: [{ find: 'const a = 1;', replace: 'const a = 2;' }] },
    });
    const { container } = render(<ToolCard tool="edit_symbol" input={input} output="applied" ok={true} />);
    expect(container.querySelector('.bg-danger-tint')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('.bg-success-tint')?.textContent).toContain('const a = 2;');
  });

  it('marks error tokens red in a failing command body, over the whole-body red', () => {
    const output = 'src/auth.ts(31,5): error TS2554: Expected 1 arguments, but got 2.\n\nExit code: 2';
    const { container } = render(<ToolCard tool="Bash" input='{"command":"tsc"}' output={output} ok={false} />);
    const marks = [...container.querySelectorAll('.text-danger')].map((n) => n.textContent);
    expect(marks).toContain('error TS2554');
    expect(marks).toContain('Exit code: 2');
    // Byte-faithful: the body still contains the exact source.
    expect(container.textContent).toContain('Expected 1 arguments, but got 2.');
  });

  it('renders get_symbol source as a byte-faithful preview once expanded', async () => {
    const src = 'export function mint(id: string): Token {\n  return new Token(id);\n}';
    const { container } = render(
      <ToolCard tool="get_symbol" input='{"ref":{"path":"src/auth.ts","symbol":"mint"}}' output={src} ok={true} />,
    );
    // Collapsed by default: the source is hidden behind Expand until opened.
    expect(container.textContent).not.toContain('return new Token(id);');
    await userEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(container.textContent).toContain('export function mint(id: string): Token {');
    expect(container.textContent).toContain('return new Token(id);');
  });

  it('collapses a read/search tool to header + Expand only until opened', () => {
    render(<ToolCard tool="Read" input='{"file_path":"src/auth.ts"}' output={'a\nb\nc'} ok={true} />);
    // The body (the file lines) is not shown inline; only an Expand control is.
    expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
    expect(screen.queryByText('a')).not.toBeInTheDocument();
  });

  it('surfaces the symbol name past the file path in a symbol tool title', () => {
    render(<ToolCard tool="get_symbol" input='{"ref":{"path":"src/auth.ts","symbol":"mint"}}' output="x" ok={true} />);
    expect(screen.getByText(/· mint/)).toBeInTheDocument();
  });

  it('shows a hunk count past the target in an apply_patch title', () => {
    const input = JSON.stringify({
      target: 'src/auth.ts',
      diff: { form: 'search-replace', hunks: [{ find: 'a', replace: 'b' }, { find: 'c', replace: 'd' }] },
    });
    render(<ToolCard tool="apply_patch" input={input} output="applied" ok={true} />);
    expect(screen.getByText(/· 2 hunks/)).toBeInTheDocument();
  });

  it('shows a failed collapsed tool as a RED error body inline (never collapsed to header-only)', () => {
    // get_symbol is collapse-by-default, but a failure (ok:false) takes priority: its
    // not-found text is always visible in the danger tint, never hidden behind Expand.
    const { container } = render(
      <ToolCard tool="get_symbol" input='{"ref":{"name":"orphan"}}' output={'not found: no-symbol'} ok={false} />,
    );
    expect(screen.getByLabelText('failed')).toBeInTheDocument();
    expect(container.textContent).toContain('not found: no-symbol');
    // No Expand affordance — the error body is shown, not collapsed.
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument();
    // The body wears the danger tint.
    expect(container.querySelector('.text-danger-text')?.textContent).toContain('not found: no-symbol');
  });

  it('renders NO body for an empty search result (0 matches shows only in the header)', () => {
    render(<ToolCard tool="Glob" input='{"pattern":"*.zzz"}' output={''} ok={true} />);
    // Empty output ⇒ no body, no broken link, no Expand.
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument();
    // The header still names the tool.
    expect(screen.getByText('Glob')).toBeInTheDocument();
  });

  it('renders WebSearch results as clickable links that fire onOpenUrl', async () => {
    const onOpenUrl = vi.fn();
    render(
      <ToolCard
        tool="WebSearch"
        input='{"query":"tokens"}'
        output={'Rotating tokens — https://ex.com/a\nsingle-use\nJWT basics — https://ex.com/b'}
        ok={true}
        onOpenUrl={onOpenUrl}
      />,
    );
    const link = screen.getByRole('button', { name: /Rotating tokens/ });
    await userEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledWith('https://ex.com/a');
    expect(screen.getByRole('button', { name: /JWT basics/ })).toBeInTheDocument();
  });

  it('renders the WebFetch source url as a clickable link in the header', async () => {
    const onOpenUrl = vi.fn();
    render(
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
  });
});
