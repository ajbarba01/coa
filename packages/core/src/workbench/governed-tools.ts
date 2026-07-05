import { z } from 'zod';
import {
  diffSpecSchema,
  symbolRefSchema,
  type CoaError,
  type SymbolRef,
  type ToolCall,
  type ToolResponse,
} from '@coa/shared';
import type { RegisteredTool } from '@coa/spi';
import { BASE_TOOL_CATALOGUE, baseToolSpecs, type BaseToolDeps } from './base-tools.js';
import { renderToolResult, toolResultOk } from './render-result.js';
import { WEB_TOOL_CATALOGUE, webToolSpecs, type WebToolDeps } from './web-tools.js';
import { TOOL_CATALOGUE } from './catalogue.js';
import { enrich, type EnrichDeps } from './enrich.js';
import { findReferences, getPiece, getSymbol, outline, type RetrieveDeps } from './retrieve.js';
import { applyPatch, editSymbol, type WorkbenchDeps } from './mutate.js';
import {
  contextStatus,
  getDecision,
  getSpec,
  runChecks,
  why,
  type InspectDeps,
} from './inspect.js';

/**
 * M6 — the governed tool-dispatch boundary. This is the seam M9 registers into
 * the rented loop: it turns M6's pure handlers into the {@link RegisteredTool}
 * port shape by wiring each to its live M1/M3/M4/M7 read/write ports and
 * decorating every return with `enrich` (grounding + gated flags). The dispatch
 * is where the two cross-cutting invariants land — inputs are Zod-validated
 * before a handler touches shared state (D141(c)), and every return is enriched
 * (F6) — so the backend adapter (M9) only has to wrap each as an SDK MCP tool.
 *
 * It is honestly partial: it builds exactly the v1 catalogue (the buildable set),
 * and `invoke` never throws and never denies (SC-1) — a malformed input or a
 * confinement/diff failure comes back as an unapplied result the agent can retry.
 */
export interface GovernedToolDeps {
  /** The owning session — stamped on each dispatched {@link ToolCall} for enrichment. */
  sessionId: string;
  /** M6 Retrieve ports (M1 reads). */
  retrieve: RetrieveDeps;
  /** M6 Mutate ports (producer ① writes). */
  mutate: WorkbenchDeps;
  /** M6 Inspect ports (M3/M4/M7 reads). */
  inspect: InspectDeps;
  /** The cross-cutting return enrichment (M4.ground + M3.flagsForAgent). */
  enrich: EnrichDeps;
  /** The pure-API base-tool ports; present only when built with includeBaseTools. */
  base?: BaseToolDeps;
  /** The pure-API web-tool ports; present only when built with includeWebTools. */
  web?: WebToolDeps;
}

/**
 * One tool's input schema + its dispatch into the M6 handler, typed against the shape.
 * Dispatch may be sync (the retrieve/mutate/inspect handlers) or async (the egress web
 * tools) — `invokeSpec` awaits either uniformly before `enrich` sees the response.
 */
export interface ToolSpec {
  shape: z.ZodRawShape;
  dispatch: (args: unknown, deps: GovernedToolDeps) => ToolResponse<unknown> | Promise<ToolResponse<unknown>>;
  refOf?: (args: unknown) => SymbolRef | undefined;
}

/** Bind a tool spec, preserving the parsed-args type from the Zod shape. */
export function spec<S extends z.ZodRawShape>(
  shape: S,
  dispatch: (
    args: z.infer<z.ZodObject<S>>,
    deps: GovernedToolDeps,
  ) => ToolResponse<unknown> | Promise<ToolResponse<unknown>>,
  refOf?: (args: z.infer<z.ZodObject<S>>) => SymbolRef | undefined,
): ToolSpec {
  return {
    shape,
    dispatch: (args, deps) => dispatch(args as z.infer<z.ZodObject<S>>, deps),
    ...(refOf ? { refOf: (args: unknown) => refOf(args as z.infer<z.ZodObject<S>>) } : {}),
  };
}

/** The buildable v1 catalogue's dispatch table, keyed by the manifest tool name. */
const SPECS: Record<string, ToolSpec> = {
  get_symbol: spec(
    { ref: symbolRefSchema },
    (a, d) => getSymbol(a.ref, d.retrieve),
    (a) => a.ref,
  ),
  outline: spec({ path: z.string() }, (a, d) => outline(a, d.retrieve)),
  find_references: spec({ symbol: z.string() }, (a, d) => findReferences(a, d.retrieve)),
  get_piece: spec({ ref: z.string() }, (a, d) => getPiece(a, d.retrieve)),
  edit_symbol: spec(
    { ref: symbolRefSchema, diff: diffSpecSchema },
    (a, d) => editSymbol(a, d.mutate),
    (a) => a.ref,
  ),
  apply_patch: spec({ target: z.string(), diff: diffSpecSchema }, (a, d) =>
    applyPatch(a, d.mutate),
  ),
  run_checks: spec({ scope: z.string().optional() }, (a, d) =>
    runChecks(a.scope !== undefined ? { scope: a.scope } : {}, d.inspect),
  ),
  context_status: spec({}, (_a, d) => contextStatus(d.inspect)),
  why: spec({ target: z.string() }, (a, d) => why(a, d.inspect)),
  get_spec: spec({ ref: z.string() }, (a, d) => getSpec(a, d.inspect)),
  get_decision: spec({ id: z.number() }, (a, d) => getDecision(a, d.inspect)),
};

/** Validate, dispatch, and enrich one tool call (SC-1: never throws, never denies). */
async function invokeSpec(
  name: string,
  toolSpec: ToolSpec,
  raw: unknown,
  deps: GovernedToolDeps,
): Promise<ToolResponse<unknown>> {
  const parsed = z.object(toolSpec.shape).safeParse(raw);
  if (!parsed.success) {
    const error: CoaError = { code: 'invalid-args', message: parsed.error.message };
    return { result: { applied: false, error }, handle: `${name}:invalid-args`, pointer: name };
  }
  const response = await toolSpec.dispatch(parsed.data, deps);
  const ref = toolSpec.refOf?.(parsed.data);
  const call: ToolCall = {
    tool: name,
    args: raw as Record<string, unknown>,
    sessionId: deps.sessionId,
    ...(ref ? { ref } : {}),
  };
  return enrich(call, response, deps.enrich);
}

/**
 * Build the governed tool surface for a session: the v1 catalogue, each wired to
 * the live handler ports and ready for M9 to register as in-process MCP tools.
 */
export function buildGovernedTools(
  deps: GovernedToolDeps,
  opts?: { includeBaseTools?: boolean; includeWebTools?: boolean },
): RegisteredTool[] {
  if (opts?.includeBaseTools && deps.base === undefined) {
    throw new Error('buildGovernedTools: includeBaseTools requires deps.base');
  }
  if (opts?.includeWebTools && deps.web === undefined) {
    throw new Error('buildGovernedTools: includeWebTools requires deps.web');
  }
  let entries = TOOL_CATALOGUE;
  let specs = SPECS;
  if (opts?.includeBaseTools) {
    entries = [...entries, ...BASE_TOOL_CATALOGUE];
    specs = { ...specs, ...baseToolSpecs() };
  }
  if (opts?.includeWebTools) {
    entries = [...entries, ...WEB_TOOL_CATALOGUE];
    specs = { ...specs, ...webToolSpecs() };
  }
  return entries.map((entry) => {
    const toolSpec = specs[entry.name];
    if (toolSpec === undefined) {
      throw new Error(`buildGovernedTools: no dispatch spec for catalogue tool '${entry.name}'`);
    }
    return {
      name: entry.name,
      description: entry.description,
      partition: entry.partition,
      inputSchema: toolSpec.shape,
      invoke: (raw: unknown) => invokeSpec(entry.name, toolSpec, raw, deps),
      // The tool owns its result shape, so it carries the per-tool display renderer the
      // pure-API loop uses for the tool_result frame + the model's tool-message content,
      // and the ok-predicate that frame's ✓/✗ (+ red error body) is derived from.
      render: (result: unknown) => renderToolResult(entry.name, result),
      ok: (result: unknown) => toolResultOk(entry.name, result),
    };
  });
}
