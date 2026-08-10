import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryView } from '@coa/console-viewmodel';

// vi.mock is hoisted above this file's imports, so the rpc stand-ins are built through
// `vi.hoisted` (the loginStore.test idiom). `onInvocableSkills` must ride the same
// mock: the store registers its invocable getter at module scope.
const rpc = vi.hoisted(() => ({
  rpcListLibrary: vi.fn(),
  rpcRescanLibrary: vi.fn(),
  rpcListSkills: vi.fn(),
  rpcLinkLibrary: vi.fn(),
  rpcCopyLibrary: vi.fn(),
  rpcUnlinkLibrary: vi.fn(),
  rpcSetLibraryEnabled: vi.fn(),
  onInvocableSkills: vi.fn(),
}));
vi.mock('../console.js', () => rpc);

import { useNotices } from '../shell/failures.js';
import { useLibraryStore } from './libraryStore.js';

const EMPTY_VIEW: LibraryView = {
  entries: [],
  discovered: { skills: [], mcpServers: [] },
  diagnostics: [],
};

const VIEW: LibraryView = {
  entries: [
    {
      record: {
        name: 'commits',
        kind: 'skill',
        mode: 'reference',
        enabled: true,
        source: { path: '/home/u/.claude/skills/commits/SKILL.md' },
      },
      scope: 'project',
      status: 'ok',
      skill: { name: 'commits', description: 'Commit style', body: 'B' },
    },
  ],
  discovered: { skills: [], mcpServers: [] },
  diagnostics: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ read: { status: 'loading' }, invocable: undefined });
  useNotices.setState({ notice: undefined });
  rpc.rpcListSkills.mockResolvedValue({ skills: [] });
});

describe('hydrate', () => {
  it('projects the daemon view and the invocable rows', async () => {
    rpc.rpcListLibrary.mockResolvedValue(VIEW);
    rpc.rpcListSkills.mockResolvedValue({
      skills: [{ name: 'commits', description: 'Commit style', scope: 'project' }],
    });
    await useLibraryStore.getState().hydrate();
    expect(useLibraryStore.getState().read).toEqual({ status: 'ok', view: VIEW });
    expect(useLibraryStore.getState().invocable).toEqual([
      { name: 'commits', description: 'Commit style', scope: 'project' },
    ]);
  });

  it('maps a cold-read failure into the error state', async () => {
    rpc.rpcListLibrary.mockRejectedValue(new Error('daemon unreachable'));
    await useLibraryStore.getState().hydrate();
    expect(useLibraryStore.getState().read).toEqual({
      status: 'error',
      message: 'daemon unreachable',
    });
  });

  it('keeps the last good view when a later re-read fails (best-effort reconcile)', async () => {
    useLibraryStore.setState({ read: { status: 'ok', view: VIEW } });
    rpc.rpcListLibrary.mockRejectedValue(new Error('blip'));
    await useLibraryStore.getState().hydrate();
    expect(useLibraryStore.getState().read).toEqual({ status: 'ok', view: VIEW });
  });

  it('keeps the last known invocable rows when only the skills read fails', async () => {
    useLibraryStore.setState({ invocable: [{ name: 'kept', description: '', scope: 'project' }] });
    rpc.rpcListLibrary.mockResolvedValue(EMPTY_VIEW);
    rpc.rpcListSkills.mockRejectedValue(new Error('blip'));
    await useLibraryStore.getState().hydrate();
    expect(useLibraryStore.getState().invocable).toEqual([
      { name: 'kept', description: '', scope: 'project' },
    ]);
  });
});

describe('rescan', () => {
  it('reprojects the fresh scan', async () => {
    rpc.rpcRescanLibrary.mockResolvedValue(VIEW);
    await useLibraryStore.getState().rescan();
    expect(useLibraryStore.getState().read).toEqual({ status: 'ok', view: VIEW });
  });

  it('announces a failed rescan but keeps showing the last good view', async () => {
    useLibraryStore.setState({ read: { status: 'ok', view: VIEW } });
    rpc.rpcRescanLibrary.mockRejectedValue(new Error('scan broke'));
    await useLibraryStore.getState().rescan();
    expect(useLibraryStore.getState().read).toEqual({ status: 'ok', view: VIEW });
    expect(useNotices.getState().notice?.title).toBe("Couldn't rescan the library");
  });
});

describe('mutations', () => {
  beforeEach(() => {
    rpc.rpcListLibrary.mockResolvedValue(EMPTY_VIEW);
  });

  it('link calls the verb with the exact args, then re-lists', async () => {
    rpc.rpcLinkLibrary.mockResolvedValue({});
    await useLibraryStore.getState().link({
      kind: 'skill',
      scope: 'personal',
      source: { path: '/x/SKILL.md' },
    });
    expect(rpc.rpcLinkLibrary).toHaveBeenCalledWith({
      kind: 'skill',
      scope: 'personal',
      source: { path: '/x/SKILL.md' },
    });
    expect(rpc.rpcListLibrary).toHaveBeenCalled();
  });

  it('copy calls the verb (the same call IS the re-sync on an existing copy)', async () => {
    rpc.rpcCopyLibrary.mockResolvedValue({});
    await useLibraryStore.getState().copy({
      kind: 'mcp',
      source: { path: '/p/.mcp.json', serverName: 'search' },
      name: 'search',
    });
    expect(rpc.rpcCopyLibrary).toHaveBeenCalledWith({
      kind: 'mcp',
      source: { path: '/p/.mcp.json', serverName: 'search' },
      name: 'search',
    });
    expect(rpc.rpcListLibrary).toHaveBeenCalled();
  });

  it('unlink and setEnabled address the entry by (kind, scope, name)', async () => {
    rpc.rpcUnlinkLibrary.mockResolvedValue({ removed: true });
    rpc.rpcSetLibraryEnabled.mockResolvedValue({});
    await useLibraryStore.getState().unlink({ kind: 'skill', scope: 'project', name: 'commits' });
    expect(rpc.rpcUnlinkLibrary).toHaveBeenCalledWith({
      kind: 'skill',
      scope: 'project',
      name: 'commits',
    });
    await useLibraryStore
      .getState()
      .setEnabled({ kind: 'mcp', scope: 'personal', name: 'search' }, false);
    expect(rpc.rpcSetLibraryEnabled).toHaveBeenCalledWith({
      kind: 'mcp',
      scope: 'personal',
      name: 'search',
      enabled: false,
    });
  });

  it('announces a refused mutation and does not re-list (nothing changed)', async () => {
    rpc.rpcLinkLibrary.mockRejectedValue(new Error('duplicate name'));
    await useLibraryStore.getState().link({
      kind: 'skill',
      scope: 'project',
      source: { path: '/x/SKILL.md' },
    });
    expect(useNotices.getState().notice?.detail).toBe('duplicate name');
    expect(rpc.rpcListLibrary).not.toHaveBeenCalled();
  });
});
