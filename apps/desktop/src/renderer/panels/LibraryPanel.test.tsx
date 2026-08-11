// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryView } from '@coa/console-viewmodel';

// The surface reaches the daemon only through the store; the store module itself pulls
// the rpc wrappers in, so the wrapper module is mocked bare — every test drives the
// store's STATE directly and asserts on the spy ACTIONS it installs.
vi.mock('./rpc.js', () => ({
  rpcListLibrary: vi.fn(),
  rpcRescanLibrary: vi.fn(),
  rpcListSkills: vi.fn(),
  rpcLinkLibrary: vi.fn(),
  rpcCopyLibrary: vi.fn(),
  rpcUnlinkLibrary: vi.fn(),
  rpcSetLibraryEnabled: vi.fn(),
  onInvocableSkills: vi.fn(),
}));

import {
  entriesFor,
  entryProblem,
  mcpSummary,
  LibraryStrip,
  LibrarySurface,
} from './LibraryPanel.js';
import { useLibraryStore } from './libraryStore.js';
import { useLibraryUi } from './libraryUi.js';

const VIEW: LibraryView = {
  entries: [
    {
      record: {
        name: 'writing',
        kind: 'skill',
        mode: 'reference',
        enabled: true,
        source: { path: '/home/u/.claude/skills/writing/SKILL.md' },
      },
      scope: 'personal',
      status: 'ok',
      skill: { name: 'writing', description: 'House style for prose', body: 'B' },
    },
    {
      record: {
        name: 'commits',
        kind: 'skill',
        mode: 'copy',
        enabled: true,
        source: { path: '/home/u/.claude/skills/commits/SKILL.md' },
        provenance: {
          sourcePath: '/home/u/.claude/skills/commits/SKILL.md',
          contentHash: 'aa',
        },
      },
      scope: 'project',
      status: 'ok',
      skill: { name: 'commits', description: 'Commit style', body: 'B' },
      drift: 'drifted',
    },
    {
      record: {
        name: 'review',
        kind: 'skill',
        mode: 'copy',
        enabled: false,
        source: { path: '/home/u/.claude/skills/review/SKILL.md' },
        provenance: { sourcePath: '/home/u/.claude/skills/review/SKILL.md', contentHash: 'bb' },
      },
      scope: 'project',
      status: 'ok',
      skill: { name: 'review', description: 'Review checklist', body: 'B' },
      drift: 'in-sync',
    },
    {
      record: {
        name: 'gone',
        kind: 'skill',
        mode: 'reference',
        enabled: true,
        source: { path: '/home/u/.claude/skills/gone/SKILL.md' },
      },
      scope: 'personal',
      status: 'source-missing',
    },
    {
      record: {
        name: 'search',
        kind: 'mcp',
        mode: 'reference',
        enabled: true,
        source: { path: '/proj/.mcp.json', serverName: 'search' },
      },
      scope: 'project',
      status: 'ok',
      mcp: { transport: 'stdio', command: 'npx', args: ['search-mcp'] },
    },
  ],
  discovered: {
    skills: [
      {
        name: 'debugging',
        description: 'Systematic debugging',
        path: '/home/u/.codex/skills/debugging/SKILL.md',
        origin: 'codex-user',
      },
    ],
    mcpServers: [
      {
        name: 'fetch',
        configPath: '/home/u/.claude.json',
        layer: 'claude-user',
        config: { transport: 'http', url: 'https://mcp.example/fetch' },
        shadowedBy: 'project-mcp',
      },
    ],
  },
  diagnostics: [
    {
      kind: 'skill',
      path: '/home/u/.claude/skills/broken/SKILL.md',
      problem: 'invalid',
      detail: 'front-matter is not valid YAML',
    },
  ],
};

const actions = {
  hydrate: vi.fn().mockResolvedValue(undefined),
  rescan: vi.fn().mockResolvedValue(undefined),
  link: vi.fn().mockResolvedValue(undefined),
  copy: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  setEnabled: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryUi.setState({ tab: 'skills' });
  useLibraryStore.setState({ read: { status: 'ok', view: VIEW }, invocable: [], ...actions });
});

describe('pure helpers', () => {
  it('summarizes an mcp config as the thing that would run/connect', () => {
    expect(mcpSummary({ transport: 'stdio', command: 'npx', args: ['x', '-y'] })).toBe('npx x -y');
    expect(mcpSummary({ transport: 'sse', url: 'https://a/b' })).toBe('https://a/b');
  });

  it('selects a tab+scope slice in stable name order', () => {
    expect(entriesFor(VIEW, 'skills', 'project').map((e) => e.record.name)).toEqual([
      'commits',
      'review',
    ]);
    expect(entriesFor(VIEW, 'mcp', 'project').map((e) => e.record.name)).toEqual(['search']);
  });

  it('names a resolution problem, and stays silent for ok', () => {
    expect(entryProblem(VIEW.entries[3]!)).toBe('Source missing');
    expect(entryProblem(VIEW.entries[0]!)).toBeUndefined();
  });
});

describe('LibrarySurface — states', () => {
  it('renders the loading skeleton before the first read lands', () => {
    useLibraryStore.setState({ read: { status: 'loading' } });
    const { container } = render(<LibrarySurface />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders a failed read as an announced error line', () => {
    useLibraryStore.setState({ read: { status: 'error', message: 'daemon unreachable' } });
    render(<LibrarySurface />);
    expect(screen.getByRole('alert')).toHaveTextContent('daemon unreachable');
  });

  it('first run: every section states its own emptiness', () => {
    useLibraryStore.setState({
      read: {
        status: 'ok',
        view: { entries: [], discovered: { skills: [], mcpServers: [] }, diagnostics: [] },
      },
    });
    render(<LibrarySurface />);
    expect(screen.getAllByText('Nothing linked')).toHaveLength(2);
    expect(screen.getByText('Nothing discovered on this machine')).toBeInTheDocument();
  });

  it('mounts through the store hydrate (the read is store-owned)', () => {
    render(<LibrarySurface />);
    expect(actions.hydrate).toHaveBeenCalled();
  });

  it('surfaces every scan diagnostic instead of swallowing it', () => {
    render(<LibrarySurface />);
    expect(screen.getByText(/front-matter is not valid YAML/)).toBeInTheDocument();
  });
});

describe('LibrarySurface — skills tab', () => {
  it('sections entries by scope and shows identity + mode', () => {
    render(<LibrarySurface />);
    const personal = screen.getByRole('list', { name: 'Personal skills' });
    expect(within(personal).getByRole('listitem', { name: 'writing' })).toBeInTheDocument();
    expect(within(personal).getByText('House style for prose')).toBeInTheDocument();
    const project = screen.getByRole('list', { name: 'Project skills' });
    expect(within(project).getAllByText('Copy')).toHaveLength(2);
    expect(within(personal).getAllByText('Reference').length).toBeGreaterThan(0);
  });

  it('drives the per-entry enable through the daemon verb', async () => {
    render(<LibrarySurface />);
    await userEvent.click(screen.getByRole('switch', { name: 'writing enabled' }));
    expect(actions.setEnabled).toHaveBeenCalledWith(
      { kind: 'skill', scope: 'personal', name: 'writing' },
      false,
    );
  });

  it('marks a drifted copy and re-syncs it with one click (a re-copy)', async () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'commits' });
    expect(within(row).getByText('Drifted')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Re-sync' }));
    expect(actions.copy).toHaveBeenCalledWith({
      kind: 'skill',
      source: { path: '/home/u/.claude/skills/commits/SKILL.md' },
      name: 'commits',
    });
  });

  it('shows no drift marker on an in-sync copy (zero renders nothing)', () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'review' });
    expect(within(row).queryByText('Drifted')).toBeNull();
  });

  it('keeps a broken reference listed, wearing the reason', () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'gone' });
    expect(within(row).getByText('Source missing')).toBeInTheDocument();
  });

  it('unlinks through the row menu', async () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'writing' });
    await userEvent.click(within(row).getByRole('button', { name: 'writing actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(actions.unlink).toHaveBeenCalledWith({
      kind: 'skill',
      scope: 'personal',
      name: 'writing',
    });
  });

  it('links a discovered skill to an explicitly chosen scope', async () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'debugging' });
    expect(within(row).getByText('Codex user')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Link debugging' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link to Personal' }));
    expect(actions.link).toHaveBeenCalledWith({
      kind: 'skill',
      scope: 'personal',
      source: { path: '/home/u/.codex/skills/debugging/SKILL.md' },
    });
  });

  it('copies a discovered skill into the project (no scope choice — a copy is project)', async () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'debugging' });
    await userEvent.click(within(row).getByRole('button', { name: 'Link debugging' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy into Project' }));
    expect(actions.copy).toHaveBeenCalledWith({
      kind: 'skill',
      source: { path: '/home/u/.codex/skills/debugging/SKILL.md' },
    });
  });
});

describe('LibrarySurface — MCP tab', () => {
  beforeEach(() => {
    useLibraryUi.setState({ tab: 'mcp' });
  });

  it('states each server config rather than inventing health', () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'search' });
    expect(within(row).getByText('stdio')).toBeInTheDocument();
    expect(within(row).getByText('npx search-mcp')).toBeInTheDocument();
  });

  it('drives the per-server enable through the daemon verb', async () => {
    render(<LibrarySurface />);
    await userEvent.click(screen.getByRole('switch', { name: 'search enabled' }));
    expect(actions.setEnabled).toHaveBeenCalledWith(
      { kind: 'mcp', scope: 'project', name: 'search' },
      false,
    );
  });

  it('surfaces layer shadowing on a discovered server and links with its serverName', async () => {
    render(<LibrarySurface />);
    const row = screen.getByRole('listitem', { name: 'fetch' });
    expect(within(row).getByText('Shadowed by .mcp.json')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Link fetch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link to Project' }));
    expect(actions.link).toHaveBeenCalledWith({
      kind: 'mcp',
      scope: 'project',
      source: { path: '/home/u/.claude.json', serverName: 'fetch' },
    });
  });
});

describe('LibraryStrip', () => {
  it('carries the entry count, the tab switch, and the rescan gesture', async () => {
    render(<LibraryStrip />);
    expect(screen.getByText('5 entries')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'MCP' }));
    expect(useLibraryUi.getState().tab).toBe('mcp');
    await userEvent.click(screen.getByRole('button', { name: 'Rescan the library' }));
    expect(actions.rescan).toHaveBeenCalled();
  });
});
