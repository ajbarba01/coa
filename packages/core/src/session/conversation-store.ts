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
import { turnFrameSchema, type TurnFrame } from '@coa/shared';

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
 *
 * Reads never throw: a corrupt `meta.json` drops that session from the listing and
 * a garbage turn line is skipped, so a hand-edited or partially-written store still
 * re-materializes what it can (the D85 floor).
 */

const metaSchema = z.object({
  id: z.string(),
  agentRef: z.string(),
  title: z.string(),
  scope: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  backendSessionId: z.string().optional(),
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
  /** Record the backend session id used to resume this conversation's memory. */
  setBackendSession(id: string, backendSessionId: string): void;
  /** Append turns to the session's stream (bumps updatedAt). */
  append(id: string, turns: PersistedTurn[]): void;
  /** The persisted turn sequence (up to and including `toSeq`, when given). */
  reload(id: string, toSeq?: number): PersistedTurn[];
  /** Delete a session's whole tree. */
  remove(id: string): void;
}

export function createConversationStore(
  dir: string,
  now: () => string = () => new Date().toISOString(),
): ConversationStore {
  const sessionDir = (id: string): string => join(dir, id);
  const metaPath = (id: string): string => join(sessionDir(id), 'meta.json');
  const turnsPath = (id: string): string => join(sessionDir(id), 'turns.ndjson');

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

    setBackendSession(id, backendSessionId) {
      touch(id, { backendSessionId });
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

    remove(id) {
      rmSync(sessionDir(id), { recursive: true, force: true });
    },
  };
}
