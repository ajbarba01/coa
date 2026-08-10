import { basename, dirname, resolve } from 'node:path';
import type {
  LibraryDiagnostic,
  LibraryDrift,
  LibraryEntryView,
  LibraryKind,
  LibraryRecord,
  LibraryScope,
  LibrarySource,
  LibraryStoreFile,
  LibrarySummary,
  LibraryView,
  McpServerEntry,
  SkillFile,
} from '@coa/shared';
import {
  defaultLibraryScanIO,
  scanLibrary,
  type LibraryPaths,
  type LibraryScanIO,
} from './discovery.js';
import { contentHash } from './hash.js';
import {
  canonicalJson,
  parseClaudeUserConfig,
  parseMcpJson,
  type NormalizedServer,
} from './mcp-config.js';
import { parseSkillFile } from './skill-file.js';
import {
  addRecord,
  assertSafeLibraryName,
  copiedSkillPath,
  defaultLibraryStoreIO,
  findRecord,
  libraryStoreDir,
  libraryStoreFilePath,
  loadStoreFile,
  removeRecord,
  replaceRecord,
  saveStoreFile,
  setRecordEnabled,
  type LibraryStoreIO,
} from './store.js';

/**
 * The library service — the one object behind the library RPC verbs. Reads are
 * always fresh from disk (a skill edited in another window is visible without a
 * restart, same posture as the agent registry); drift is computed inside the
 * read, hash-on-demand, never watched. Mutations refuse loudly (a throw the
 * RPC router turns into an ordinary error reply) rather than half-succeeding.
 *
 * Link is the default relationship: the record points at the source and every
 * read re-resolves it. Copy materializes into the PROJECT store (committable)
 * with provenance; calling copy again on the same entry IS the one-click
 * re-sync (re-copy + refreshed hash). Disable is surfacing-only — a disabled
 * entry stays listed and is simply excluded from whatever consumes the
 * library (a pass-through, never a cage).
 */

export interface LibraryServiceDeps {
  readonly home: string;
  readonly projectRoot: string;
  readonly scanIO?: LibraryScanIO;
  readonly storeIO?: LibraryStoreIO;
}

export interface LinkArgs {
  kind: LibraryKind;
  scope: LibraryScope;
  source: LibrarySource;
  /** Defaults to the skill's directory name / the MCP server's name. */
  name?: string | undefined;
}

export interface CopyArgs {
  kind: LibraryKind;
  source: LibrarySource;
  name?: string | undefined;
}

export interface EntryRef {
  kind: LibraryKind;
  scope: LibraryScope;
  name: string;
}

const SCOPES: readonly LibraryScope[] = ['personal', 'project'];

export class LibraryService {
  readonly #paths: LibraryPaths;
  readonly #scanIO: LibraryScanIO;
  readonly #storeIO: LibraryStoreIO;

  constructor(deps: LibraryServiceDeps) {
    this.#paths = { home: deps.home, projectRoot: deps.projectRoot };
    this.#scanIO = deps.scanIO ?? defaultLibraryScanIO;
    this.#storeIO = deps.storeIO ?? defaultLibraryStoreIO;
  }

  /** The one read the UI needs: entries (resolved + drift) ∪ discovered ∪ diagnostics. */
  list(): LibraryView {
    const scan = scanLibrary(this.#paths, this.#scanIO);
    const diagnostics: LibraryDiagnostic[] = [...scan.diagnostics];
    const entries: LibraryEntryView[] = [];
    /** Source identities already claimed by a record — these leave "discovered". */
    const claimed = new Set<string>();

    for (const scope of SCOPES) {
      const loaded = loadStoreFile(this.#storeFilePath(scope), scope, this.#storeIO);
      diagnostics.push(...loaded.diagnostics);
      for (const record of loaded.file.records) {
        claimed.add(sourceIdentity(record.source));
        entries.push(this.#resolveEntry(record, scope, diagnostics));
      }
    }

    return {
      entries,
      discovered: {
        skills: scan.skills.filter((s) => !claimed.has(sourceIdentity({ path: s.path }))),
        mcpServers: scan.mcpServers.filter(
          (s) => !claimed.has(sourceIdentity({ path: s.configPath, serverName: s.name })),
        ),
      },
      diagnostics,
    };
  }

  /** Link a source as a live reference into a scope's store. */
  link(args: LinkArgs): LibrarySummary {
    const name = args.name ?? this.#deriveName(args.kind, args.source);
    assertSafeLibraryName(name);
    // Validate the source NOW — a link to nothing is a refusal, not a dead record.
    this.#resolveSource(args.kind, args.source);
    const record: LibraryRecord = {
      name,
      kind: args.kind,
      mode: 'reference',
      enabled: true,
      source: args.source,
    };
    this.#mutate(args.scope, (file) => {
      const added = addRecord(file, record);
      if (!added.ok) throw new Error(added.error);
      return added.file;
    });
    return { record, scope: args.scope };
  }

  /**
   * Copy a source into the PROJECT store (committable), recording provenance.
   * Calling it again for an existing copy record refreshes it — the re-sync.
   * A reference record already claiming the name refuses (unlink it first).
   */
  copy(args: CopyArgs): LibrarySummary {
    const name = args.name ?? this.#deriveName(args.kind, args.source);
    assertSafeLibraryName(name);
    const resolved = this.#resolveSource(args.kind, args.source);

    const record: LibraryRecord = {
      name,
      kind: args.kind,
      mode: 'copy',
      enabled: true,
      source: args.source,
      provenance: { sourcePath: args.source.path, contentHash: resolved.hash },
      ...(resolved.kind === 'mcp' ? { mcp: resolved.entry } : {}),
    };

    this.#mutate('project', (file) => {
      const existing = findRecord(file, args.kind, name);
      if (existing !== undefined && existing.mode !== 'copy') {
        throw new Error(`"${name}" is linked as a reference; unlink it before copying`);
      }
      // Keep the enabled choice across a re-sync — re-copy refreshes content, not intent.
      const next = existing !== undefined ? { ...record, enabled: existing.enabled } : record;
      if (resolved.kind === 'skill') {
        this.#storeIO.writeFile(copiedSkillPath(this.#storeDir('project'), name), resolved.text);
      }
      return existing !== undefined ? replaceRecord(file, next) : mustAdd(file, next);
    });
    return { record, scope: 'project' };
  }

  /** Remove a record; a skill copy's materialized directory goes with it. `false` = nothing there. */
  unlink(ref: EntryRef): boolean {
    let removed = false;
    this.#mutate(ref.scope, (file) => {
      const result = removeRecord(file, ref.kind, ref.name);
      removed = result.removed !== undefined;
      if (
        result.removed !== undefined &&
        result.removed.kind === 'skill' &&
        result.removed.mode === 'copy'
      ) {
        this.#storeIO.removeDir(
          dirname(copiedSkillPath(this.#storeDir(ref.scope), result.removed.name)),
        );
      }
      return result.file;
    });
    return removed;
  }

  setEnabled(ref: EntryRef, enabled: boolean): LibrarySummary {
    let updated: LibraryRecord | undefined;
    this.#mutate(ref.scope, (file) => {
      const result = setRecordEnabled(file, ref.kind, ref.name, enabled);
      updated = result.record;
      return result.file;
    });
    if (updated === undefined) {
      throw new Error(`no ${ref.kind} entry named "${ref.name}" in the ${ref.scope} store`);
    }
    return { record: updated, scope: ref.scope };
  }

  #storeDir(scope: LibraryScope): string {
    return libraryStoreDir(this.#paths.home, this.#paths.projectRoot, scope);
  }

  #storeFilePath(scope: LibraryScope): string {
    return libraryStoreFilePath(this.#storeDir(scope));
  }

  /** Load → mutate → save, one scope at a time (single-daemon, attended v1 — no cross-process lock). */
  #mutate(scope: LibraryScope, change: (file: LibraryStoreFile) => LibraryStoreFile): void {
    const path = this.#storeFilePath(scope);
    const loaded = loadStoreFile(path, scope, this.#storeIO);
    saveStoreFile(path, change(loaded.file), this.#storeIO);
  }

  #deriveName(kind: LibraryKind, source: LibrarySource): string {
    if (kind === 'mcp') {
      if (source.serverName === undefined) throw new Error('an mcp source must name its server');
      return source.serverName;
    }
    // A skill's default name is its directory's, Claude Code's own fallback.
    return basename(dirname(source.path));
  }

  /** Resolve a source's CURRENT content, or throw with the reason. */
  #resolveSource(
    kind: LibraryKind,
    source: LibrarySource,
  ):
    | { kind: 'skill'; skill: SkillFile; text: string; hash: string }
    | { kind: 'mcp'; entry: McpServerEntry; hash: string } {
    if (kind === 'skill') {
      let text: string;
      try {
        text = this.#scanIO.readFile(source.path);
      } catch {
        throw new Error(`skill source not readable: ${source.path}`);
      }
      const skill = parseSkillFile(text, basename(dirname(source.path)));
      return { kind: 'skill', skill, text, hash: contentHash(text) };
    }

    if (source.serverName === undefined) throw new Error('an mcp source must name its server');
    const server = this.#readMcpServer(source.path, source.serverName);
    if (server === undefined) {
      throw new Error(`no MCP server "${source.serverName}" in ${source.path}`);
    }
    if (!server.ok) {
      throw new Error(`MCP server "${source.serverName}" is invalid: ${server.error}`);
    }
    return { kind: 'mcp', entry: server.entry, hash: contentHash(canonicalJson(server.raw)) };
  }

  /**
   * Find one server in a config file. `.mcp.json` is a flat map; `~/.claude.json`
   * carries two layers, resolved local-first (Claude Code's own precedence).
   */
  #readMcpServer(configPath: string, serverName: string): NormalizedServer | undefined {
    let text: string;
    try {
      text = this.#scanIO.readFile(configPath);
    } catch {
      return undefined;
    }
    try {
      if (basename(configPath) === '.mcp.json') {
        return parseMcpJson(text).servers[serverName];
      }
      const parsed = parseClaudeUserConfig(text, this.#paths.projectRoot, samePath);
      return parsed.local[serverName] ?? parsed.user[serverName];
    } catch {
      return undefined;
    }
  }

  #resolveEntry(
    record: LibraryRecord,
    scope: LibraryScope,
    diagnostics: LibraryDiagnostic[],
  ): LibraryEntryView {
    if (record.kind === 'skill') {
      return record.mode === 'reference'
        ? this.#resolveSkillReference(record, scope, diagnostics)
        : this.#resolveSkillCopy(record, scope, diagnostics);
    }
    return record.mode === 'reference'
      ? this.#resolveMcpReference(record, scope, diagnostics)
      : this.#resolveMcpCopy(record, scope);
  }

  #resolveSkillReference(
    record: LibraryRecord,
    scope: LibraryScope,
    diagnostics: LibraryDiagnostic[],
  ): LibraryEntryView {
    let text: string;
    try {
      text = this.#scanIO.readFile(record.source.path);
    } catch {
      diagnostics.push(missingSource(record, scope, record.source.path));
      return { record, scope, status: 'source-missing' };
    }
    try {
      const skill = parseSkillFile(text, record.name);
      return { record, scope, status: 'ok', skill };
    } catch (err) {
      diagnostics.push(invalidSource(record, scope, record.source.path, err));
      return { record, scope, status: 'invalid-source' };
    }
  }

  #resolveSkillCopy(
    record: LibraryRecord,
    scope: LibraryScope,
    diagnostics: LibraryDiagnostic[],
  ): LibraryEntryView {
    const path = copiedSkillPath(this.#storeDir(scope), record.name);
    let view: LibraryEntryView;
    try {
      const skill = parseSkillFile(this.#storeIO.readFile(path), record.name);
      view = { record, scope, status: 'ok', skill };
    } catch (err) {
      // The MATERIALIZED file is broken/gone — a store problem, distinct from source drift.
      diagnostics.push(invalidSource(record, scope, path, err));
      view = { record, scope, status: 'invalid-source' };
    }
    return { ...view, drift: this.#skillDrift(record) };
  }

  #skillDrift(record: LibraryRecord): LibraryDrift {
    let text: string;
    try {
      text = this.#scanIO.readFile(record.source.path);
    } catch {
      return 'source-missing';
    }
    return contentHash(text) === record.provenance?.contentHash ? 'in-sync' : 'drifted';
  }

  #resolveMcpReference(
    record: LibraryRecord,
    scope: LibraryScope,
    diagnostics: LibraryDiagnostic[],
  ): LibraryEntryView {
    const serverName = record.source.serverName ?? record.name;
    const server = this.#readMcpServer(record.source.path, serverName);
    if (server === undefined) {
      diagnostics.push(missingSource(record, scope, record.source.path));
      return { record, scope, status: 'source-missing' };
    }
    if (!server.ok) {
      diagnostics.push(invalidSource(record, scope, record.source.path, new Error(server.error)));
      return { record, scope, status: 'invalid-source' };
    }
    return { record, scope, status: 'ok', mcp: server.entry };
  }

  #resolveMcpCopy(record: LibraryRecord, scope: LibraryScope): LibraryEntryView {
    // The store is the source of truth for a copy — the materialized config renders
    // even when the original source is long gone; drift says so honestly.
    const serverName = record.source.serverName ?? record.name;
    const server = this.#readMcpServer(record.source.path, serverName);
    const drift: LibraryDrift =
      server === undefined || !server.ok
        ? 'source-missing'
        : contentHash(canonicalJson(server.raw)) === record.provenance?.contentHash
          ? 'in-sync'
          : 'drifted';
    return {
      record,
      scope,
      status: 'ok',
      ...(record.mcp !== undefined ? { mcp: record.mcp } : {}),
      drift,
    };
  }
}

function mustAdd(file: LibraryStoreFile, record: LibraryRecord): LibraryStoreFile {
  const added = addRecord(file, record);
  if (!added.ok) throw new Error(added.error);
  return added.file;
}

function missingSource(
  record: LibraryRecord,
  scope: LibraryScope,
  path: string,
): LibraryDiagnostic {
  return {
    kind: record.kind,
    name: record.name,
    path,
    scope,
    problem: 'missing-source',
    detail: `linked source is gone: ${path}`,
  };
}

function invalidSource(
  record: LibraryRecord,
  scope: LibraryScope,
  path: string,
  err: unknown,
): LibraryDiagnostic {
  return {
    kind: record.kind,
    name: record.name,
    path,
    scope,
    problem: 'invalid',
    detail: err instanceof Error ? err.message : 'unreadable',
  };
}

/** Case-folded path-resolve equality (see discovery.ts — Windows paths are case-preserving). */
function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/** One string per source so "already linked" matching is set-membership. */
function sourceIdentity(source: LibrarySource): string {
  const path = resolve(source.path).toLowerCase();
  return source.serverName === undefined ? path : `${path}::${source.serverName}`;
}
