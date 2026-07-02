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
  backendMessageSchema,
  capabilityFrameSchema,
  claudeReasoningSchema,
  neutralConfigSchema,
  turnFrameSchema,
  type BackendMessage,
  type ModelSelection,
  type TurnFrame,
} from '@coa/shared';
import type { FrozenCompilation } from './prompt-freeze.js';

/**
 * M8 — the R-7 conversation store. It mirrors each session's conversation to a
 * gitignored per-session tree under `.coa/local/conversation/<id>/` (SPEC R-7 keys
 * this by worktree; until the worktree manager D90/D96 lands every session shares
 * the repo root, so the session id stands in for the worktree — the documented
 * tripwire). Each session directory holds:
 *   - `meta.json`      — the session index entry (agent, title, timestamps, the
 *                        backend session id used to resume the loop's memory)
 *   - `turns.ndjson`   — the append-only `TurnFrame` sequence (R-7.a), each line a
 *                        `{ seq, frame }` — the durable analog of the live `turn` Push.
 *   - `messages.json`  — the **canonical** provider-neutral chat transcript (system
 *                        omitted), rewritten each turn. Unlike the lossy `turns.ndjson`
 *                        UI view (a tool-result pointer, not its full output), this is
 *                        the verbatim, full-content message array — the single source of
 *                        truth for cross-turn memory. EVERY backend populates it (the
 *                        Claude adapter maps its SDK stream to the same shape), so a
 *                        conversation can be replayed into any backend: a pure-API
 *                        backend resends it as `history` for continuity + cache warmth,
 *                        and it is the lossless source when a session switches providers.
 *                        A server-session backend (Claude) additionally keeps
 *                        `backendSessionId` as a same-provider `resume` fast path.
 *   - `compilation.json` — the session's FROZEN compiled prompt (the neutral config +
 *                        capability frame + its `promptVersion`). Written once at the
 *                        first turn and reused verbatim thereafter, so the provider's
 *                        prompt cache stays warm; a deliberate recompile rewrites it.
 *
 * Reads never throw: a corrupt `meta.json` drops that session from the listing, a
 * garbage turn line is skipped, and an unparseable `messages.json` reads as no memory
 * — so a hand-edited or partially-written store still re-materializes what it can
 * (the D85 floor).
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
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const frozenCompilationSchema = z.object({
  neutral: neutralConfigSchema,
  frame: capabilityFrameSchema,
  promptVersion: z.string(),
  configHash: z.string(),
  config: promptConfigSchema,
});

const metaSchema = z.object({
  id: z.string(),
  agentRef: z.string(),
  title: z.string(),
  scope: z.string(),
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

/** A persisted turn: the M0 `TurnFrame` with the monotonic `seq` M8 assigned it. */
export interface PersistedTurn {
  seq: number;
  frame: TurnFrame;
}

const persistedTurnSchema = z.object({ seq: z.number(), frame: turnFrameSchema });

export interface ConversationStore {
  /** Start a session: write its initial metadata (createdAt = updatedAt = now). */
  create(init: { id: string; agentRef: string; title: string; scope: string }): SessionMeta;
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
  /** Append turns to the session's stream (bumps updatedAt). */
  append(id: string, turns: PersistedTurn[]): void;
  /** The persisted turn sequence (up to and including `toSeq`, when given). */
  reload(id: string, toSeq?: number): PersistedTurn[];
  /** The canonical neutral transcript (system omitted); empty if none / unparseable. */
  loadBackendMessages(id: string): BackendMessage[];
  /** Replace the canonical neutral transcript (rewritten in full each turn). */
  saveBackendMessages(id: string, messages: readonly BackendMessage[]): void;
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

const backendMessagesSchema = z.array(backendMessageSchema);

export function createConversationStore(
  dir: string,
  now: () => string = () => new Date().toISOString(),
): ConversationStore {
  const sessionDir = (id: string): string => join(dir, id);
  const metaPath = (id: string): string => join(sessionDir(id), 'meta.json');
  const turnsPath = (id: string): string => join(sessionDir(id), 'turns.ndjson');
  const messagesPath = (id: string): string => join(sessionDir(id), 'messages.json');
  const compilationPath = (id: string): string => join(sessionDir(id), 'compilation.json');

  const readMeta = (id: string): SessionMeta | undefined => {
    const path = metaPath(id);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = metaSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined; // unreadable/partial write → treat as absent (never throw)
    }
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
    create({ id, agentRef, title, scope }) {
      const ts = now();
      const meta: SessionMeta = { id, agentRef, title, scope, createdAt: ts, updatedAt: ts };
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

    append(id, turns) {
      if (turns.length === 0) return;
      mkdirSync(sessionDir(id), { recursive: true });
      const lines = turns.map((t) => `${JSON.stringify(t)}\n`).join('');
      appendFileSync(turnsPath(id), lines, 'utf8');
      touch(id, {});
    },

    reload(id, toSeq) {
      const path = turnsPath(id);
      if (!existsSync(path)) return [];
      const out: PersistedTurn[] = [];
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          continue; // skip a garbage line (D85 floor: re-materialize what we can)
        }
        const parsed = persistedTurnSchema.safeParse(raw);
        if (!parsed.success) continue;
        if (toSeq !== undefined && parsed.data.seq > toSeq) continue;
        out.push(parsed.data);
      }
      return out;
    },

    loadBackendMessages(id) {
      const path = messagesPath(id);
      if (!existsSync(path)) return [];
      try {
        const parsed = backendMessagesSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
        return parsed.success ? parsed.data : []; // all-or-nothing: a partial transcript would malform tool pairing
      } catch {
        return []; // unreadable/partial write → no memory (never throw)
      }
    },

    saveBackendMessages(id, messages) {
      mkdirSync(sessionDir(id), { recursive: true });
      writeFileSync(messagesPath(id), `${JSON.stringify(messages, null, 2)}\n`, 'utf8');
      touch(id, {});
    },

    getCompilation(id) {
      const path = compilationPath(id);
      if (!existsSync(path)) return undefined;
      try {
        const parsed = frozenCompilationSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
        return parsed.success ? parsed.data : undefined; // unparseable ⇒ recompile fresh (never throw)
      } catch {
        return undefined;
      }
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
