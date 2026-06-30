import type Parser from 'tree-sitter';

/**
 * The serializable inner shape of an M0 {@link CST} `tree`. A plain object graph
 * — no native handles — so the parse tree crosses the D112 child-process
 * boundary as JSON and the byte-pure extractors walk it without the tree-sitter
 * addon. It mirrors the concrete syntax tree faithfully: every child (named and
 * anonymous) is retained, each carrying its own `text` so name/operator/token
 * lookups need no back-reference to the source.
 */
export interface Point {
  row: number;
  column: number;
}

export interface SerializedNode {
  type: string;
  /** Named nodes map to grammar rules; anonymous nodes are literal tokens (`&&`, `{`). */
  named: boolean;
  text: string;
  startPosition: Point;
  endPosition: Point;
  startIndex: number;
  endIndex: number;
  children: SerializedNode[];
}

/** Serialize a native tree-sitter node (and its whole subtree) into a {@link SerializedNode}. */
export function serializeNode(node: Parser.SyntaxNode): SerializedNode {
  return {
    type: node.type,
    named: node.isNamed,
    text: node.text,
    startPosition: { row: node.startPosition.row, column: node.startPosition.column },
    endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    children: node.children.map(serializeNode),
  };
}

/** Depth-first iterator over a serialized subtree (the node itself first). */
export function* walk(node: SerializedNode): Generator<SerializedNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}
