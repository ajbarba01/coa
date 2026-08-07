import type { AgentSummary, CoaError, ToolResponse } from '@coa/shared';

/**
 * M6 — the model-facing subagent-dispatch surface. `spawn_agent` is an ordinary coa
 * tool: `PreToolUse` gates it exactly like every other call (ADR-0029), so no
 * governance surface lives here. The ports below are declared, not supplied — the
 * daemon injects the real registry read + child-session start at the composition
 * root once the child-session plumbing exists.
 */
export interface SpawnDeps {
  /** The LIVE effective agent set. Called per dispatch — never a list cached at session start. */
  listAgents: () => readonly AgentSummary[];
  /** Start the child and return once it has STARTED, never once it has finished. */
  startChild: (req: { agentRef: string; description: string; prompt: string }) => {
    sessionId: string;
  };
}

/** The outcome of a spawn attempt: applied with the child's id, or unapplied with the reason. */
export type SpawnResult =
  | { applied: true; agentRef: string; sessionId: string }
  | { applied: false; error: CoaError };

/**
 * How much of a hostile string to echo back into a model-facing reply. Long
 * enough that genuine content is still legible, short enough that a deliberately
 * huge value can't flood the reply. Shared by every field this module echoes
 * verbatim, so one bound rather than a different tunable per field.
 */
const MAX_ECHOED_LENGTH = 200;

/**
 * How many rows the known-agents listing shows before truncating. This bounds
 * the REPLY, not the registry: a large registry (or one deliberately flooded
 * with junk definition files) must not turn one unknown-ref reply into an
 * unbounded wall of text. A truncated listing still states how many rows were
 * left out (see the trailing line built below) — a silent cut that happens to
 * hide the one agent the model needed would be strictly worse than a long
 * reply, so the omission itself has to be legible rather than invisible.
 */
const MAX_LISTED_AGENTS = 50;

/**
 * Flatten a string with no upstream format guarantee before it is interpolated
 * into a model-facing message. This module echoes three such strings: the
 * caller-supplied `agent` text on an unknown ref (here, and
 * `governed-tools.ts`'s absent-port branch), and — in the known-agents listing
 * built for that same unknown-ref reply — an `AgentSummary`'s `name` and
 * `description`. Unlike a registry `ref` (constrained by `agent-defs.ts`'s
 * `SAFE_REF`, a single-path-segment regex with no whitespace or control
 * characters), none of these three has any such guarantee: `agent` is
 * model-chosen text, and `name`/`description` come from agent YAML files that
 * may be hand-authored or imported from elsewhere. Any of them could otherwise
 * carry a newline (or the Unicode line/paragraph separators a browser-rendered
 * transcript treats as hard breaks the same way) and make injected text look
 * like a second, line-initial notice. Collapse every C0 control character, DEL,
 * and those two separators to a single space so the string stays inert data
 * inside its fixed sentence, and cap the length. Exported so every call site
 * shares one sanitizer rather than drifting apart — the same shape as
 * `notify.ts`'s `sanitizeDetail`.
 */
export function sanitizeEchoedText(raw: string, maxLength: number = MAX_ECHOED_LENGTH): string {
  let flattened = '';
  let sawSpace = false;
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f || code === 8232 || code === 8233;
    if (isControl) {
      if (!sawSpace) {
        flattened += ' ';
        sawSpace = true;
      }
      continue;
    }
    flattened += ch;
    sawSpace = ch === ' ';
  }
  flattened = flattened.trim();
  if (flattened.length === 0) return '(empty)';
  return flattened.length > maxLength ? `${flattened.slice(0, maxLength)}…` : flattened;
}

/**
 * Dispatch a subagent by name. Resolution is against the LIVE registry on every
 * call: compiled prompts are frozen byte-stable for cache warmth, so any list baked
 * at session start is stale the moment an agent is authored.
 *
 * SC-1: an unknown ref is an unapplied result naming what does exist, never a throw
 * and never a denial — the model can correct itself and retry. `description` and
 * `prompt` are opaque data on every path here: they are forwarded to `startChild`
 * unexamined and never interpolated into a message this handler constructs, so they
 * carry no injection surface of their own within this module.
 */
export function spawnAgent(
  args: { agent: string; description: string; prompt: string },
  deps: SpawnDeps,
): ToolResponse<SpawnResult> {
  const agents = deps.listAgents();
  const match = agents.find((a) => a.ref === args.agent);
  if (match === undefined) {
    // One JSON object per line, not a hand-built label string: a delimiter like
    // `ref: ` or ` — ` is still ordinary printable text, so a hostile `name`/
    // `description` could plant a second, decoy-looking `ref: <token>` on the
    // same line and steer a good-faith retry onto an agent the model never
    // chose. JSON.stringify's quoting/escaping makes `ref` a single value no
    // amount of attacker-controlled string content can imitate — the guarantee
    // comes from the format's escaping semantics, not from denying particular
    // substrings, so no future field or separator can reopen this the way a
    // blocklist would. `name`/`description` still go through the same flatten
    // (below) first: `JSON.stringify` escapes quotes/backslashes/C0 controls,
    // but not U+2028/U+2029, so that step is still required before encoding.
    const shown = agents.slice(0, MAX_LISTED_AGENTS);
    const omitted = agents.length - shown.length;
    const rows = shown.map((a) =>
      JSON.stringify({
        ref: a.ref,
        name: sanitizeEchoedText(a.name),
        description: sanitizeEchoedText(a.description),
      }),
    );
    if (omitted > 0) {
      rows.push(`… ${omitted} more agent${omitted === 1 ? '' : 's'} not shown`);
    }
    const known = rows.join('\n');
    const safeRef = sanitizeEchoedText(args.agent);
    const error: CoaError = {
      code: 'unknown-agent',
      message: `No agent '${safeRef}'. Available agents — one JSON object per line, pass \`ref\` as the agent argument:\n${known}`,
    };
    return {
      result: { applied: false, error },
      handle: `spawn_agent:${safeRef}`,
      pointer: safeRef,
    };
  }
  const { sessionId } = deps.startChild({
    agentRef: match.ref,
    description: args.description,
    prompt: args.prompt,
  });
  return {
    result: { applied: true, agentRef: match.ref, sessionId },
    handle: `spawn_agent:${sessionId}`,
    pointer: sessionId,
  };
}
