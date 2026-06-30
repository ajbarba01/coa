import { createHash } from 'node:crypto';
import Parser from 'tree-sitter';
import TSGrammar from 'tree-sitter-typescript';
import JSGrammar from 'tree-sitter-javascript';
import type { CST } from '@coa/shared';
import { hasGrammar, type GrammaredLang } from './languages.js';
import { serializeNode, type Point, type SerializedNode } from './cst.js';

/** The bytes-and-language unit `parse` consumes. The CST it returns carries no path. */
export interface SourceFile {
  lang: string;
  bytes: string;
}

/** `parse` returns the failure across the D112 boundary; it never throws there. */
export type ParseResult = CST | { ok: false; reason: 'crash' | 'timeout' };

// The native Language objects expose `{ language, nodeTypeInfo }`, structurally a
// `Parser.Language` minus its self-referential `language` field type. The cast is
// the one unavoidable seam between the grammar packages and the parser binding.
const NATIVE_GRAMMAR: Record<GrammaredLang, Parser.Language> = {
  typescript: TSGrammar.typescript as unknown as Parser.Language,
  tsx: TSGrammar.tsx as unknown as Parser.Language,
  javascript: JSGrammar as unknown as Parser.Language,
};

/**
 * Parse source bytes to a serializable CST.
 *
 * D112 — the parser runs in-process and synchronously in v1; the isolation seam
 * (running tree-sitter in a separate child process) is a build flag, not a
 * re-tooling. The sync signature is honored in-process by catching a native
 * crash and *returning* `{ ok:false, reason:'crash' }`; the `'timeout'` variant
 * is reserved for the isolated child-process path (a sync in-process parse
 * cannot time out). When the same logic runs behind `./parser-process`, the
 * child wraps the call and maps a non-response to the same failure union.
 *
 * An ungrammared language is not a failure: it returns the Tier-0 floor — a
 * single degenerate node spanning the file — so callers get a uniform CST and
 * `extractSymbols`/`extractMetrics` degrade by construction (D85).
 */
export function parse(file: SourceFile): ParseResult {
  const bytesHash = createHash('sha256').update(file.bytes, 'utf8').digest('hex');

  if (!hasGrammar(file.lang)) {
    return { lang: file.lang, tree: floorNode(file.bytes), bytesHash };
  }

  try {
    const parser = new Parser();
    parser.setLanguage(NATIVE_GRAMMAR[file.lang]);
    const tree = parser.parse(file.bytes);
    return { lang: file.lang, tree: serializeNode(tree.rootNode), bytesHash };
  } catch {
    return { ok: false, reason: 'crash' };
  }
}

/** The Tier-0 floor tree: one node covering the whole file, no structure. */
function floorNode(bytes: string): SerializedNode {
  return {
    type: 'source',
    named: true,
    text: bytes,
    startPosition: { row: 0, column: 0 },
    endPosition: endPoint(bytes),
    startIndex: 0,
    endIndex: Buffer.byteLength(bytes, 'utf8'),
    children: [],
  };
}

function endPoint(bytes: string): Point {
  const lines = bytes.split('\n');
  const row = lines.length - 1;
  return { row, column: lines[row]?.length ?? 0 };
}
