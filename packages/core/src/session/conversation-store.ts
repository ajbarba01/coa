import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  capabilityFrameSchema,
  claudeReasoningSchema,
  neutralConfigSchema,
  turnFrameSchema,
  type BackendMessage,
  type ModelSelection,
  type TurnFrame,
} from '@coa/shared';
import type { FrozenCompilation } from './prompt-freeze.js';
import { foldEventsToTranscript, type PersistedEvent } from './transcript-projection.js';

/**
 * The persistent conversation store. It mirrors each session's conversation to a
 * gitignored per-session tree under `.coa/local/conversation/<id>/` (the spec keys
 * this by worktree; until the worktree manager lands every session shares
 * the repo root, so the session id stands in for the worktree — the documented
 * tripwire). Each session directory holds:
 *   - `meta.json`        — the session index entry (agent, title, timestamps, the
 *                          backend session id used to resume the loop's memory)
 *   - `events.ndjson`    — ONE append-only event log, each line a
 *                          {@link PersistedEvent} (`{ seq, frame, full? }`) — the
 *                          UNCHANGED wire frame plus, for a `tool_result`, the full
 *                          body the model saw. `messages.json`/`turns.ndjson` are
 *                          retired: there is no separate whole-rewrite transcript file
 *                          — the provider-neutral transcript is a READ-TIME FOLD of
 *                          this log (`foldEventsToTranscript`), so the UI view
 *                          (`reload`, frame-only) and the canonical memory
 *                          (`loadBackendMessages`) can never drift apart.
 *   - `compilation.json` — the session's FROZEN compiled prompt (the neutral config +
 *                          capability frame + its `promptVersion`). Written once at the
 *                          first turn and reused verbatim thereafter, so the provider's
 *                          prompt cache stays warm; a deliberate recompile rewrites it.
 *
 * Reads never throw: a corrupt `meta.json` drops that session from the listing, and a
 * garbage `events.ndjson` line is skipped — so a hand-edited or partially-written store
 * still re-materializes what it can (the degrade-to-what-we-can floor).
 *
 * What is dropped is COUNTED and reported, because "what we can" and "all of it" look
 * identical to a reader otherwise. The event log is the same record the console draws a
 * transcript from and the model is handed back as its memory, so a partly-flushed append
 * that silently loses lines produces a transcript that reads as complete and a model that
 * quietly forgot something. `reload` returns the count with the turns; every reader
 * reports through {@link ConversationStoreOptions.reportUnreadable} so the daemon can log
 * it. Both are reports — nothing here starts throwing.
 */

/** The (provider, model) a `backendSessionId` was captured under — the native
 *  `resume` fast path is only valid while the live selection still matches this
 *  stamp. A provider or model switch leaves the token present but ineligible, so
 *  the session falls back to replaying the neutral transcript into the new backend. */
const resumeStampSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  /** The frozen prompt version the token was captured under — a deliberate recompile
   *  bumps it, so the token becomes ineligible and the next turn starts a fresh
   *  server session with the new prompt (rather than resuming the stale one). */
  promptVersion: z.string().optional(),
});
export type ResumeStamp = z.infer<typeof resumeStampSchema>;

const promptConfigSchema = z.object({
  role: z.string(),
  /** The chosen roles (canonical); a sorted copy. Absent ⇒ falls back to `role`. */
  roles: z.array(z.string()).optional(),
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

/** The model facts the frozen `## Model` line was compiled with — gates freeze REUSE
 *  (a model switch recompiles) but is deliberately NOT part of the drift key. */
const modelPromptKeySchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  effort: z.string().optional(),
});

const frozenCompilationSchema = z.object({
  neutral: neutralConfigSchema,
  frame: capabilityFrameSchema,
  promptVersion: z.string(),
  configHash: z.string(),
  config: promptConfigSchema,
  model: modelPromptKeySchema.optional(),
});

const metaSchema = z.object({
  id: z.string(),
  agentRef: z.string(),
  title: z.string(),
  scope: z.string(),
  /** The session that spawned this one; absent ⇒ a root session a person started. */
  parent: z.string().optional(),
  /** The root of this session's family tree — itself, for a root. Stored rather than
   *  walked: a parent chain can cycle, and a stored root is constant-time and cannot. */
  root: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  backendSessionId: z.string().optional(),
  /** The provider/model/reasoning the session actually runs on — pinned at the
   *  first send and used verbatim on every later turn (incl. after a restart), so
   *  routing never silently drifts to a different backend than the memory lives in. */
  provider: z.string().optional(),
  model: z.string().optional(),
  reasoning: claudeReasoningSchema.optional(),
  /** What the {@link SessionMeta.backendSessionId} resume token is valid for. */
  resumeStamp: resumeStampSchema.optional(),
});

/** A session's index entry — the durable metadata behind the rail's `SessionSummary`. */
export type SessionMeta = z.infer<typeof metaSchema>;

/** A persisted turn — the UI view of the event log: the wire `TurnFrame` with the
 *  monotonic `seq` the session layer assigned it (the persistence-only `full` body, when present, is
 *  dropped — that's the fold's job, not the raw frame stream's). */
export interface PersistedTurn {
  seq: number;
  frame: TurnFrame;
}

/** Validates one `events.ndjson` line — the on-disk shape of a {@link PersistedEvent}. */
const persistedEventSchema = z.object({
  seq: z.number(),
  frame: turnFrameSchema,
  full: z.string().optional(),
});

/** A reloaded conversation: the turns that could be read, and how many stored events
 *  could not be. A non-zero `skipped` means the transcript is a fragment — the reader
 *  is told so rather than handed the remainder as the whole record. */
export interface ReloadedConversation {
  turns: PersistedTurn[];
  skipped: number;
}

/** One never-throwing read that had to drop something, reported so the daemon can log it. */
export interface UnreadableRecord {
  sessionId: string;
  /** Which of the session's files: the event log, its metadata, or its frozen prompt. */
  file: 'events' | 'meta' | 'compilation';
  /** How many records were lost — event lines, or 1 for a whole file that would not parse. */
  count: number;
}

export interface ConversationStoreOptions {
  /** Called whenever a read drops a record. Default: ignore (the store on its own is a
   *  pure disk mirror; the daemon decides what to do with the report). */
  reportUnreadable?: (dropped: UnreadableRecord) => void;
}

export interface ConversationStore {
  /** Start a session: write its initial metadata (createdAt = updatedAt = now). */
  create(init: {
    id: string;
    agentRef: string;
    title: string;
    scope: string;
    parent?: string;
    root?: string;
  }): SessionMeta;
  /** Every session, most-recently-active first. Corrupt entries are skipped. */
  list(): SessionMeta[];
  /** One session's metadata, or undefined if it does not exist / is corrupt. */
  getMeta(id: string): SessionMeta | undefined;
  /** Retitle a session (bumps updatedAt). No-op if the session is gone. */
  rename(id: string, title: string): void;
  /** Pin the provider/model/reasoning the session actually runs on. Fields left
   *  undefined are cleared (the selection is replaced, not merged). No-op if gone. */
  setSelection(id: string, selection: ModelSelection): void;
  /** Record the backend session id used to resume this conversation's memory, and
   *  the provider/model it is valid for (the native `resume` fast path is honored
   *  only while the live selection still matches this stamp). */
  setBackendSession(id: string, backendSessionId: string, stamp: ResumeStamp): void;
  /** Drop the resume token (backend session id + stamp), so the next turn starts a
   *  fresh server session (carrying memory via the transcript). Used by a deliberate
   *  prompt recompile: the old server session still holds the superseded prompt. */
  clearBackendSession(id: string): void;
  /** Append events to the session's log (bumps updatedAt). */
  append(id: string, events: PersistedEvent[]): void;
  /** The persisted turn sequence (up to and including `toSeq`, when given) — the frame
   *  stream, `full` dropped (the UI view) — plus the count of stored events too corrupt
   *  to read, so a truncated transcript can be shown as truncated. */
  reload(id: string, toSeq?: number): ReloadedConversation;
  /** The canonical neutral transcript (system omitted) — a read-time fold of the event
   *  log; empty if none / unparseable. */
  loadBackendMessages(id: string): BackendMessage[];
  /** The session's frozen compilation (the byte-stable prompt reused every turn), or
   *  undefined before the first turn compiles it / if unparseable. */
  getCompilation(id: string): FrozenCompilation | undefined;
  /** Freeze the session's compilation so every later turn reuses it verbatim (cache-stable). */
  setCompilation(id: string, compilation: FrozenCompilation): void;
  /** Drop the frozen compilation so the next turn recompiles from the current config
   *  (a deliberate recompile — the drift banner's `recompile` action). */
  clearCompilation(id: string): void;
  /** Delete a session's whole tree. */
  remove(id: string): void;
}

export function createConversationStore(
  dir: string,
  now: () => string = () => new Date().toISOString(),
  options: ConversationStoreOptions = {},
): ConversationStore {
  const report = options.reportUnreadable ?? ((): void => {});
  const sessionDir = (id: string): string => join(dir, id);
  const metaPath = (id: string): string => join(sessionDir(id), 'meta.json');
  const eventsPath = (id: string): string => join(sessionDir(id), 'events.ndjson');
  const compilationPath = (id: string): string => join(sessionDir(id), 'compilation.json');

  /** Read + validate the raw event log, skipping any garbage line (never throw;
   *  re-materialize what we can) and counting every line skipped. */
  const readEvents = (id: string): { events: PersistedEvent[]; skipped: number } => {
    const path = eventsPath(id);
    if (!existsSync(path)) return { events: [], skipped: 0 };
    const events: PersistedEvent[] = [];
    let skipped = 0;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        skipped += 1; // a garbage line: re-materialize what we can, and say how much we could not
        continue;
      }
      const parsed = persistedEventSchema.safeParse(raw);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const { seq, frame, full } = parsed.data;
      // `exactOptionalPropertyTypes`: zod's `.optional()` yields `full: string | undefined`
      // (a present-but-undefined key), not the absent-key `full?: string` PersistedEvent wants.
      events.push(full !== undefined ? { seq, frame, full } : { seq, frame });
    }
    if (skipped > 0) report({ sessionId: id, file: 'events', count: skipped });
    return { events, skipped };
  };

  const readMeta = (id: string): SessionMeta | undefined => {
    const path = metaPath(id);
    if (!existsSync(path)) return undefined; // never written / already removed — nothing was lost
    try {
      const parsed = metaSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through — an unreadable/partial write reads as absent (never throw)
    }
    // The file is THERE and unreadable, which is a session dropping out of the listing
    // rather than a session that was never created. Those look the same to a caller.
    report({ sessionId: id, file: 'meta', count: 1 });
    return undefined;
  };

  const writeMeta = (meta: SessionMeta): void => {
    mkdirSync(sessionDir(meta.id), { recursive: true });
    writeFileSync(metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  };

  /** Re-read, patch, and rewrite a session's metadata, always bumping updatedAt. */
  const touch = (id: string, patch: Partial<SessionMeta>): void => {
    const meta = readMeta(id);
    if (meta === undefined) return;
    writeMeta({ ...meta, ...patch, updatedAt: now() });
  };

  return {
    create({ id, agentRef, title, scope, parent, root }) {
      const ts = now();
      const meta: SessionMeta = {
        id,
        agentRef,
        title,
        scope,
        createdAt: ts,
        updatedAt: ts,
        ...(parent !== undefined ? { parent } : {}),
        ...(root !== undefined ? { root } : {}),
      };
      writeMeta(meta);
      return meta;
    },

    list() {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => readMeta(e.name))
        .filter((m): m is SessionMeta => m !== undefined)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    getMeta(id) {
      return readMeta(id);
    },

    rename(id, title) {
      touch(id, { title });
    },

    setSelection(id, selection) {
      const meta = readMeta(id);
      if (meta === undefined) return;
      // Replace the selection wholesale (undefined fields clear), so a switch to an
      // account-default model/reasoning doesn't leave a stale pin behind.
      const next: SessionMeta = { ...meta, updatedAt: now() };
      if (selection.provider !== undefined) next.provider = selection.provider;
      else delete next.provider;
      if (selection.model !== undefined) next.model = selection.model;
      else delete next.model;
      if (selection.reasoning !== undefined) next.reasoning = selection.reasoning;
      else delete next.reasoning;
      writeMeta(next);
    },

    setBackendSession(id, backendSessionId, stamp) {
      touch(id, { backendSessionId, resumeStamp: stamp });
    },

    clearBackendSession(id) {
      const meta = readMeta(id);
      if (meta === undefined) return;
      const { backendSessionId: _bsid, resumeStamp: _stamp, ...rest } = meta;
      writeMeta({ ...rest, updatedAt: now() });
    },

    append(id, events) {
      if (events.length === 0) return;
      mkdirSync(sessionDir(id), { recursive: true });
      const lines = events.map((e) => `${JSON.stringify(e)}\n`).join('');
      appendFileSync(eventsPath(id), lines, 'utf8');
      touch(id, {});
    },

    reload(id, toSeq) {
      const { events, skipped } = readEvents(id);
      const turns = events
        .filter((e) => toSeq === undefined || e.seq <= toSeq)
        .map(({ seq, frame }) => ({ seq, frame }));
      return { turns, skipped };
    },

    loadBackendMessages(id) {
      return foldEventsToTranscript(readEvents(id).events);
    },

    getCompilation(id) {
      const path = compilationPath(id);
      if (!existsSync(path)) return undefined; // no prompt frozen yet — nothing was lost
      try {
        const parsed = frozenCompilationSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
        if (parsed.success) return parsed.data;
      } catch {
        // fall through — unparseable ⇒ recompile fresh (never throw)
      }
      report({ sessionId: id, file: 'compilation', count: 1 });
      return undefined;
    },

    setCompilation(id, compilation) {
      mkdirSync(sessionDir(id), { recursive: true });
      writeFileSync(compilationPath(id), `${JSON.stringify(compilation, null, 2)}\n`, 'utf8');
    },

    clearCompilation(id) {
      rmSync(compilationPath(id), { force: true });
    },

    remove(id) {
      rmSync(sessionDir(id), { recursive: true, force: true });
    },
  };
}
