import type { GraphEdge } from '@coa/shared';

/**
 * GRF-3 — deterministic, per-ecosystem **convention extractors**. The
 * tree-sitter import floor misses two whole edge classes (codegen/config wiring;
 * runtime/registry/DI wiring) that, in every stressed repo, are exactly where the
 * real architecture lives. Extractors are pluggable deterministic pattern
 * matchers (P1) that **auto-engage where a known convention exists and contribute
 * nothing where it does not** (D85). They emit `convention`-provenance edges —
 * local/derived (D49), rebuilt on reparse, never committed to the WAL (whose edge
 * frames carry only `declared`/`gated`). An unresolvable match is reported as an
 * unresolved site (anti-false-graph), never silently dropped.
 */
export interface ExtractionResult {
  edges: GraphEdge[];
  /** Sites where a convention matched but the target could not be resolved. */
  unresolved: string[];
}

export interface ConventionExtractor {
  id: string;
  ecosystem: string;
  extract(file: { path: string; lang: string; bytes: string }): ExtractionResult;
}

/** Codegen markers: `@generated from <source>` → a `generated-from` edge. */
export const codegenMarkerExtractor: ConventionExtractor = {
  id: 'codegen-marker',
  ecosystem: 'generic',
  extract(file) {
    const edges: GraphEdge[] = [];
    const withSource = /@generated\s+from\s+(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = withSource.exec(file.bytes)) !== null) {
      const source = match[1];
      if (source !== undefined) {
        edges.push({
          from: file.path,
          to: source,
          type: 'generated-from',
          provenance: 'convention',
        });
      }
    }
    // A bare `@generated` with no resolvable source is an unresolved site.
    const unresolved = edges.length === 0 && /@generated\b/.test(file.bytes) ? [file.path] : [];
    return { edges, unresolved };
  },
};

/** TS/JS DI/registry call-sites: `registerSingleton(Token, Impl)` → a `depends-on` edge. */
export const registrySingletonExtractor: ConventionExtractor = {
  id: 'register-singleton',
  ecosystem: 'ts-js',
  extract(file) {
    const edges: GraphEdge[] = [];
    const call = /registerSingleton\(\s*\w+\s*,\s*(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = call.exec(file.bytes)) !== null) {
      const impl = match[1];
      if (impl !== undefined) {
        edges.push({ from: file.path, to: impl, type: 'depends-on', provenance: 'convention' });
      }
    }
    return { edges, unresolved: [] };
  },
};

/** The starter set shipped this round; more are additive and degrade to the floor. */
export const STARTER_EXTRACTORS: readonly ConventionExtractor[] = [
  codegenMarkerExtractor,
  registrySingletonExtractor,
];

export class ExtractorRegistry {
  private readonly extractors: ConventionExtractor[] = [];

  register(extractor: ConventionExtractor): void {
    this.extractors.push(extractor);
  }

  /** Run every registered extractor over a file, aggregating edges + unresolved sites. */
  run(file: { path: string; lang: string; bytes: string }): ExtractionResult {
    const edges: GraphEdge[] = [];
    const unresolved: string[] = [];
    for (const extractor of this.extractors) {
      const result = extractor.extract(file);
      edges.push(...result.edges);
      unresolved.push(...result.unresolved);
    }
    return { edges, unresolved };
  }
}
