import type { z } from 'zod';
import type { SymbolRef, ToolResponse } from '@coa/shared';

/**
 * One tool's input schema + its dispatch into the workbench handler, typed against the shape.
 * Dispatch may be sync (the retrieve/mutate/inspect handlers) or async (the egress web
 * tools) — `invokeSpec` awaits either uniformly before `enrich` sees the response.
 *
 * `D` is the dependency bag a dispatch receives. Each dispatch table pins the
 * narrowest type it needs (its own ports), so the tables and the aggregate wiring
 * type that combines them can live in separate modules without a dependency cycle.
 */
export interface ToolSpec<D> {
  shape: z.ZodRawShape;
  dispatch: (args: unknown, deps: D) => ToolResponse<unknown> | Promise<ToolResponse<unknown>>;
  refOf?: (args: unknown) => SymbolRef | undefined;
}

/** Bind a tool spec, preserving the parsed-args type from the Zod shape. */
export function spec<S extends z.ZodRawShape, D>(
  shape: S,
  dispatch: (
    args: z.infer<z.ZodObject<S>>,
    deps: D,
  ) => ToolResponse<unknown> | Promise<ToolResponse<unknown>>,
  refOf?: (args: z.infer<z.ZodObject<S>>) => SymbolRef | undefined,
): ToolSpec<D> {
  return {
    shape,
    dispatch: (args, deps) => dispatch(args as z.infer<z.ZodObject<S>>, deps),
    ...(refOf ? { refOf: (args: unknown) => refOf(args as z.infer<z.ZodObject<S>>) } : {}),
  };
}
