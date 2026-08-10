import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * The durable inter-agent message log (docs/adr/0039). Deliberately NOT the change-event
 * spine — a message is conversational traffic between agents, not a fact about what
 * changed in the codebase, so it gets its own append-only file rather than bloating the
 * spine with data no "what changed" consumer wants (the design doc's own reasoning,
 * `docs/superpowers/specs/2026-08-04-inter-agent-messaging-and-dispatch-design.md`).
 *
 * One file per family-tree ROOT (`.coa/local/messages/<root>.ndjson`), not per session:
 * addressing is a mesh within a root's whole tree, so every message any two of its
 * members exchange belongs to the same durable record — mirrors `LedgerRecord.root`'s
 * existing "the tree, not the session, is the accounting unit" convention
 * (`docs/adr/0032`). Reads never throw: a corrupt line is skipped, mirroring
 * `conversation-store.ts`'s own never-throw-on-read-a-mirror-of-disk floor.
 */

/** One message on the mesh. `from`/`to` are session ids (or the reserved, unforgeable
 *  `'system'` sender — never produced by a tool handler, reserved for a future
 *  daemon-authored broadcast; nothing here emits one yet). `threadId` is the id of the
 *  FIRST message in the exchange — a fresh message is its own thread; a reply carries the
 *  thread it replies into (`message-dispatch.ts`'s `dispatchMessage` resolves it via
 *  `replyTo`, never trusted from the caller directly). */
export const agentMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  replyTo: z.string().optional(),
  from: z.string(),
  to: z.string(),
  root: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

/** The reserved, unforgeable system sender id (docs/adr/0039's "reserve an unforgeable
 *  system sender id now" decision) — no producer in this arc writes one; reserved so a
 *  later daemon-authored broadcast (e.g. "the root's cost is nearly exhausted") has an
 *  id no session could ever collide with (daemon session ids are ULIDs, never the bare
 *  string `'system'`). */
export const SYSTEM_SENDER = 'system';

export interface MessageLog {
  /** Append one message to its root's durable log (bumps nothing else — the log is
   *  pure history, no separate index to keep in sync). */
  append(message: AgentMessage): void;
  /** One message by id, within a given root's log — `undefined` if the root has no log
   *  yet or the id isn't in it. Used to resolve a reply's `threadId` from the message it
   *  replies to. */
  get(root: string, id: string): AgentMessage | undefined;
  /** Every message belonging to `root`'s tree, in append order (oldest first) — the
   *  read `dispatchMessage`'s pure `resolveThread` deps close over, and the read a
   *  future roster/liveness surface would join against. `[]` for a root with no
   *  messages yet (never throws). */
  forRoot(root: string): readonly AgentMessage[];
}

/** Read + validate one root's ndjson file, skipping any garbage line (never throw —
 *  re-materialize what can be read, matching `conversation-store.ts`'s own floor). */
function readLog(path: string): AgentMessage[] {
  if (!existsSync(path)) return [];
  const out: AgentMessage[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue; // a garbage line: re-materialize what we can
    }
    const parsed = agentMessageSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function createMessageLog(dir: string): MessageLog {
  const pathFor = (root: string): string => join(dir, `${root}.ndjson`);
  // A small in-process cache keyed by root: a daemon process is long-lived and this
  // log is read far more often (every dispatch's mesh/thread checks) than it is
  // written, so re-parsing the whole file on every read would be wasteful at even a
  // moderate message count. Populated lazily (first read or first append) and kept in
  // sync by every `append` — there is no other writer of these files, so the cache can
  // never go stale against itself. A fresh daemon process starts with an empty cache
  // and reads from disk on first touch, exactly like `ConversationStore` does.
  const cache = new Map<string, AgentMessage[]>();

  const load = (root: string): AgentMessage[] => {
    const existing = cache.get(root);
    if (existing !== undefined) return existing;
    const loaded = readLog(pathFor(root));
    cache.set(root, loaded);
    return loaded;
  };

  return {
    append(message) {
      // Load (and thereby cache) BEFORE writing to disk: `load` re-parses the file from
      // disk on a cache miss, so loading after the write would read this very message
      // back in and then push it a second time.
      const cached = load(message.root);
      mkdirSync(dir, { recursive: true });
      appendFileSync(pathFor(message.root), `${JSON.stringify(message)}\n`, 'utf8');
      cached.push(message);
    },
    get(root, id) {
      return load(root).find((m) => m.id === id);
    },
    forRoot(root) {
      return load(root);
    },
  };
}
