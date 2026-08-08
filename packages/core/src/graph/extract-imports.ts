import type { CST, GraphEdge } from '@coa/shared';
import { walk, type SerializedNode } from '@coa/code-intel';

/**
 * The tree-sitter import-graph floor. The kernel drives the parser's `parse` and walks the CST
 * for static `import`/re-export source specifiers, emitting `inferred` `imports`
 * edges — the language-agnostic structural floor every consumer reads. The convention
 * extractors layer fidelity on top of it; a language-server-backed precise layer was
 * always the intended third tier and is not built. Specifier
 * resolution (relative → repo path) is delegated to the caller's resolver, which
 * knows the indexed file set. It cannot see dynamic/string-keyed imports;
 * those are the convention extractors' domain.
 */
export function extractImports(
  cst: CST,
  fromPath: string,
  resolve: (specifier: string, fromPath: string) => string,
): GraphEdge[] {
  const root = cst.tree as SerializedNode;
  const edges: GraphEdge[] = [];
  for (const node of walk(root)) {
    if (node.type !== 'import_statement' && node.type !== 'export_statement') continue;
    const source = node.children.find((c) => c.type === 'string');
    if (!source) continue;
    const specifier = stripQuotes(source.text);
    if (specifier.length === 0) continue;
    edges.push({
      from: fromPath,
      to: resolve(specifier, fromPath),
      type: 'imports',
      provenance: 'inferred',
    });
  }
  return edges;
}

function stripQuotes(text: string): string {
  const first = text[0];
  if ((first === '"' || first === "'" || first === '`') && text.length >= 2) {
    return text.slice(1, -1);
  }
  return text;
}
