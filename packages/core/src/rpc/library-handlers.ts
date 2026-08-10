import {
  libraryKindSchema,
  libraryScopeSchema,
  librarySourceSchema,
  type LibrarySummary,
  type LibraryView,
} from '@coa/shared';
import { z } from 'zod';
import type { CopyArgs, EntryRef, LinkArgs } from '../library/service.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The library verbs — the console's management surface for skills and MCP
 * servers (the Library panel renders exactly what `listLibrary` returns; the
 * stores are the source of truth, the daemon only reads/mutates them).
 *
 * `listLibrary` and `rescanLibrary` are the same fresh read (reads are never
 * cached, so a rescan IS a list); both exist so the UI has an explicit refresh
 * gesture without overloading the initial load. Mutations that cannot happen
 * (unknown entry, duplicate name, missing source) THROW inside the port, and
 * the router turns that into an ordinary coded error reply — a mutation never
 * half-succeeds silently.
 */
export interface LibraryPorts {
  list: () => LibraryView;
  link: (args: LinkArgs) => LibrarySummary;
  copy: (args: CopyArgs) => LibrarySummary;
  /** `false` means there was nothing there to remove (a second unlink is a no-op). */
  unlink: (ref: EntryRef) => boolean;
  setEnabled: (ref: EntryRef, enabled: boolean) => LibrarySummary;
}

const noParams = z.unknown().optional();
const entryRefParams = z.object({
  kind: libraryKindSchema,
  scope: libraryScopeSchema,
  name: z.string().min(1),
});
const linkParams = z.object({
  kind: libraryKindSchema,
  scope: libraryScopeSchema,
  source: librarySourceSchema,
  name: z.string().min(1).optional(),
});
const copyParams = z.object({
  kind: libraryKindSchema,
  source: librarySourceSchema,
  name: z.string().min(1).optional(),
});
const setEnabledParams = entryRefParams.extend({ enabled: z.boolean() });

export function buildLibraryHandlers(ports: LibraryPorts): RpcHandlers {
  return {
    listLibrary: rpcMethod(noParams, () => ports.list()),
    rescanLibrary: rpcMethod(noParams, () => ports.list()),
    linkLibrary: rpcMethod(linkParams, (p) => ports.link(p)),
    copyLibrary: rpcMethod(copyParams, (p) => ports.copy(p)),
    unlinkLibrary: rpcMethod(entryRefParams, (p) => ({ removed: ports.unlink(p) })),
    setLibraryEnabled: rpcMethod(setEnabledParams, (p) =>
      ports.setEnabled({ kind: p.kind, scope: p.scope, name: p.name }, p.enabled),
    ),
  };
}
