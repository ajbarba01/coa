/**
 * The frame vocabulary: what a turn can contain.
 *
 * It lives in its own module rather than beside the component that renders it because the
 * helpers which reason about frames (scroll position, search) legitimately need the type
 * while the component needs them — importing it from `Transcript.tsx` made that a cycle.
 * The data a renderer renders is not owned by the renderer.
 */
export type TranscriptRole = 'you' | 'agent' | 'subagent';

/** One rendered turn frame. A discriminated union so each kind renders on its own
 *  footing; `raw` is the verbatim (unfiltered-loop) projection. */
export type TranscriptFrame =
  | {
      id: string;
      role: TranscriptRole;
      kind: 'text';
      text: string;
      depth?: number | undefined;
      /** True while this block is still streaming (fed by `text-delta`) — drives the
       *  per-word reveal. Absent/false once settled or on reload (plain, no reveal). */
      streaming?: boolean | undefined;
      /** True while this is the viewer's own text that the agent has not picked up yet.
       *  It is not in the record and may never be (a steer is recorded only when the
       *  model receives it), so it renders as
       *  provisional rather than as something that happened. */
      pending?: boolean | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'tool-use';
      tool: string;
      input: string;
      handle?: string | undefined;
      depth?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'tool-result';
      tool: string;
      output: string;
      ok: boolean;
      handle?: string | undefined;
      depth?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'tool';
      tool: string;
      input: string;
      handle?: string | undefined;
      output?: string | undefined;
      ok?: boolean | undefined;
      depth?: number | undefined;
    }
  | {
      id: string;
      kind: 'approval';
      requestId: string;
      tool: string;
      summary: string;
      diffStat?: string | undefined;
      resolved?: 'approved' | 'denied' | undefined;
    }
  | { id: string; kind: 'deny'; denyKind: 'close-gate'; reason: string }
  | { id: string; kind: 'raw'; text: string }
  | { id: string; kind: 'note'; text: string }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'thinking';
      text: string;
      depth?: number | undefined;
      /** True while the reasoning is still streaming (fed by `thinking-delta`) — drives the
       *  auto-expand + per-word reveal; on settle it collapses. Absent on reload. */
      streaming?: boolean | undefined;
      /** Persisted wall-clock (ms) the reasoning took — renders "Thought for Ns" identically
       *  live and on reload (a token count is derived from `text`). Absent while streaming. */
      durationMs?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'plan';
      items: { text: string; status: 'pending' | 'in-progress' | 'done' }[];
      depth?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'error';
      message: string;
      origin?: 'tool' | 'loop' | 'daemon' | undefined;
      depth?: number | undefined;
    }
  | {
      id: string;
      kind: 'subagent';
      childWorktree: string;
      event: 'spawn-proposal' | 'spawn' | 'running' | 'idle' | 'done' | 'rollup';
      depth?: number | undefined;
      rollup?:
        | {
            tools?: number | undefined;
            tokens?: number | undefined;
            cost?: number | undefined;
            status?: string | undefined;
          }
        | undefined;
    };
