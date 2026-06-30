/**
 * @coa/code-intel (M2) — the pure, language-tiered, graph-free byte→structure
 * layer. Every method is a function of bytes / a CST / an M0 type and never
 * reads the graph, which is what lets M2 build before M1.
 */

export { tierFor, type TierInput } from './tier.js';
export { parse, type SourceFile, type ParseResult } from './parser.js';
export { canonicalize } from './canonicalize.js';
export { extractSymbols } from './extract-symbols.js';
export { extractMetrics } from './extract-metrics.js';
export { hasGrammar, langFromPath, type GrammaredLang } from './languages.js';
export { walk, type SerializedNode, type Point } from './cst.js';
export { handleParseRequest } from './parser-process.js';
