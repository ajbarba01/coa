import type { SymbolRecord } from '@coa/shared';

/**
 * GRF-6 — the SCIP interop export. coa builds its nav/code-intel layer bespoke
 * but **emits SCIP** (Sourcegraph's protocol; human-readable string symbol IDs)
 * so the index is future-proof and consumable by other tooling. This is a
 * one-way export verb (`coa export-scip`), never an internal dependency. v1
 * emits a SCIP-shaped index as JSON bytes; the protobuf wire encoding and the
 * public SCIP consume / round-trip are deferred (OPEN.md).
 */
export interface ScipSymbol {
  /** A human-readable string symbol id (SCIP-flavored, coa scheme). */
  symbol: string;
  descriptor: string;
  kind?: string;
}

export interface ScipDocument {
  relativePath: string;
  symbols: ScipSymbol[];
}

export interface ScipIndex {
  metadata: { version: number; toolInfo: { name: string; version: string }; projectRoot: string };
  documents: ScipDocument[];
}

export interface ScipOptions {
  projectRoot: string;
  toolVersion: string;
}

export function buildScipIndex(symbols: SymbolRecord[], options: ScipOptions): ScipIndex {
  const byFile = new Map<string, ScipSymbol[]>();
  for (const record of symbols) {
    const path = pathOf(record.definedIn);
    const entry: ScipSymbol = {
      symbol: `coa . ${path} . ${record.name}`,
      descriptor: record.name,
      ...(record.kind !== undefined ? { kind: record.kind } : {}),
    };
    const bucket = byFile.get(path);
    if (bucket) bucket.push(entry);
    else byFile.set(path, [entry]);
  }

  const documents: ScipDocument[] = [...byFile.entries()]
    .map(([relativePath, syms]) => ({
      relativePath,
      symbols: syms.sort((a, b) =>
        a.descriptor < b.descriptor ? -1 : a.descriptor > b.descriptor ? 1 : 0,
      ),
    }))
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));

  return {
    metadata: {
      version: 0,
      toolInfo: { name: 'coa', version: options.toolVersion },
      projectRoot: options.projectRoot,
    },
    documents,
  };
}

/** Serialize the SCIP index to bytes (the export verb's output). */
export function exportScip(symbols: SymbolRecord[], options: ScipOptions): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(buildScipIndex(symbols, options)));
}

/** Strip the trailing `:line:col` from a qualified `definedIn` to recover the path. */
function pathOf(definedIn: string): string {
  const parts = definedIn.split(':');
  return parts.length > 2 ? parts.slice(0, parts.length - 2).join(':') : (parts[0] ?? definedIn);
}
