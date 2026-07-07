import type { ClaudeEffort, ClaudeReasoning, ModelSelection, Push, TurnFrame } from '@coa/shared';

/**
 * The `coa run` presentation layer — pure functions the streaming client uses to
 * turn CON-PUSH records into terminal lines and to detect the terminal status.
 * Kept free of IO so the rendering is unit-tested without a live daemon; the
 * client (in `cli.ts`) owns the socket + the actual writes.
 */

/** Parsed `coa run` invocation: flags + the trailing prompt, or an error. */
export type RunArgs =
  | { role?: string; scope?: string; model?: ModelSelection; input: string }
  | { error: string };

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Parse a `--reasoning` spec into the faithful ClaudeReasoning, or an error string. */
function parseReasoning(spec: string): ClaudeReasoning | { error: string } {
  if (spec === 'off') return { mode: 'off' };
  if ((EFFORTS as readonly string[]).includes(spec)) {
    return { mode: 'effort', effort: spec as ClaudeEffort };
  }
  if (spec.startsWith('budget:')) {
    const n = Number(spec.slice('budget:'.length));
    if (Number.isInteger(n) && n > 0) return { mode: 'budget', budgetTokens: n };
  }
  return { error: `coa run: --reasoning must be off|${EFFORTS.join('|')}|budget:<tokens>` };
}

export function parseRunArgs(args: string[]): RunArgs {
  let role: string | undefined;
  let scope: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let reasoning: ClaudeReasoning | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--role') role = args[(i += 1)];
    else if (arg === '--scope') scope = args[(i += 1)];
    else if (arg === '--provider') provider = args[(i += 1)];
    else if (arg === '--model') model = args[(i += 1)];
    else if (arg === '--reasoning') {
      const parsed = parseReasoning(args[(i += 1)] ?? '');
      if ('error' in parsed) return parsed;
      reasoning = parsed;
    } else if (arg !== undefined) rest.push(arg);
  }
  const input = rest.join(' ').trim();
  if (input === '') return { error: 'coa run: a prompt is required' };
  const selection: ModelSelection = {
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
  return {
    ...(role !== undefined ? { role } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(Object.keys(selection).length > 0 ? { model: selection } : {}),
    input,
  };
}

export interface Rendered {
  /** Lines to print for this record (may be empty). */
  lines: string[];
  /**
   * Set when this record ends the session — `'error'` if the loop failed,
   * `'interrupted'` for a clean user-initiated stop (SC-1: never treated as a failure).
   */
  terminal?: 'done' | 'error' | 'interrupted';
}

/** Render one CON-PUSH record. Turn frames become transcript lines; a status may be terminal. */
export function renderPush(push: Push): Rendered {
  switch (push.kind) {
    case 'turn':
      return { lines: renderFrame(push.frame) };
    case 'status':
      switch (push.state) {
        case 'done':
          return { lines: [], terminal: 'done' };
        case 'error':
          return { lines: ['✗ session ended with an error'], terminal: 'error' };
        case 'interrupted':
          return { lines: ['⏹ interrupted'], terminal: 'interrupted' };
        default:
          return { lines: [] };
      }
    case 'cost':
      return { lines: [`  cost $${push.spent.toFixed(2)}`] };
    default:
      return { lines: [] };
  }
}

function renderFrame(frame: TurnFrame): string[] {
  switch (frame.t) {
    case 'text':
      return [frame.text];
    case 'thinking':
      return [`⋯ ${frame.text}`];
    case 'tool_use':
      return [`→ ${frame.tool} ${compact(frame.input)}`];
    case 'tool_result':
      return [`  ${frame.ok ? '✓' : '✗'} ${firstLine(frame.pointer)}`];
    case 'error':
      return [`✗ error (${frame.origin}): ${frame.message}`];
    case 'turn-boundary':
      return [''];
    default:
      return [];
  }
}

/** A compact single-line form of a tool's args, truncated so a big input never floods the terminal. */
function compact(input: Record<string, unknown>): string {
  const json = JSON.stringify(input);
  return json.length > 80 ? `${json.slice(0, 77)}...` : json;
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}
