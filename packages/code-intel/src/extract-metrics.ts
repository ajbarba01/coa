import type { CST, MetricSample } from '@coa/shared';
import { hasGrammar } from './languages.js';
import { walk, type SerializedNode } from './cst.js';

/**
 * Walk a parsed CST and emit byte-local per-function AST health metrics — the
 * HLT-6 `ast` basis: cognitive complexity (the one well-validated local metric)
 * plus `size-loc` (the HLT-3 confound control, always reported alongside).
 *
 * Where a grammar affords it (Tier-2) this yields a `cognitive-complexity` and a
 * `size-loc` sample per function. Where it does not, it degrades to the size-only
 * floor: a single file-level `size-loc` sample (D85 — coa never asserts a
 * complexity it cannot soundly compute). `walPosition` is a byte-local placeholder
 * (`0`); M1 stamps the real position when it indexes the samples onto the symbol
 * tier (GRF-2). M2 holds no resident state and computes no graph/temporal metric.
 */
export function extractMetrics(cst: CST): MetricSample[] {
  const root = cst.tree as SerializedNode;

  if (!hasGrammar(cst.lang)) {
    return [
      {
        metric: 'size-loc',
        granularity: 'file',
        target: '',
        value: lineSpan(root),
        sizeLoc: lineSpan(root),
        basis: 'ast',
        confidence: 'low',
        walPosition: 0,
      },
    ];
  }

  const out: MetricSample[] = [];
  for (const node of walk(root)) {
    if (!FUNCTION_TYPES.has(node.type)) continue;
    const target = locationOf(node);
    const loc = lineSpan(node);
    out.push(sample('cognitive-complexity', target, cognitiveComplexity(node), loc));
    out.push(sample('size-loc', target, loc, loc));
  }
  return out;
}

const FUNCTION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
]);

/** Control-flow structures that each add `1 + nesting` and deepen nesting for their bodies. */
const NESTING_STRUCTURES = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'catch_clause',
  'switch_statement',
  'ternary_expression',
  'conditional_expression',
]);

/**
 * Cognitive complexity (Sonar-style): a `+1` for each break in linear flow, an
 * added penalty for nesting depth, a flat `+1` for `else`/`else if` (no nesting),
 * and a `+1` per boolean-operator *sequence* (a run of one operator counts once;
 * alternating operators each add one).
 */
function cognitiveComplexity(fnNode: SerializedNode): number {
  const body =
    fnNode.children.find((c) => c.type === 'statement_block') ??
    fnNode.children.find((c) => c.type !== 'formal_parameters' && c.named);
  return body ? score(body, 0, null, false) : 0;
}

function score(
  node: SerializedNode,
  nesting: number,
  enclosingLogicalOp: string | null,
  isElseChainIf: boolean,
): number {
  let total = 0;
  let childNesting = nesting;
  let childLogicalOp = enclosingLogicalOp;

  if (NESTING_STRUCTURES.has(node.type)) {
    if (!isElseChainIf) total += 1 + nesting;
    childNesting = nesting + 1;
    childLogicalOp = null;
  } else if (node.type === 'else_clause') {
    total += 1;
    childLogicalOp = null;
  } else {
    const op = logicalOperator(node);
    if (op !== null) {
      if (op !== enclosingLogicalOp) total += 1;
      childLogicalOp = op;
    }
  }

  for (const child of node.children) {
    const elseChainIf = node.type === 'else_clause' && child.type === 'if_statement';
    total += score(child, childNesting, childLogicalOp, elseChainIf);
  }
  return total;
}

/** The `&&` / `||` operator of a binary expression, or `null` if it is not a logical one. */
function logicalOperator(node: SerializedNode): string | null {
  if (node.type !== 'binary_expression') return null;
  for (const child of node.children) {
    if (child.type === '&&' || child.type === '||') return child.type;
  }
  return null;
}

function sample(
  metric: 'cognitive-complexity' | 'size-loc',
  target: string,
  value: number,
  loc: number,
): MetricSample {
  return {
    metric,
    granularity: 'symbol',
    target,
    value,
    sizeLoc: loc,
    basis: 'ast',
    confidence: 'high',
    walPosition: 0,
  };
}

/** Rows a node spans, 1-based and inclusive. */
function lineSpan(node: SerializedNode): number {
  return node.endPosition.row - node.startPosition.row + 1;
}

/** An in-file `line:column` location (1-based), matching the symbol convention. */
function locationOf(node: SerializedNode): string {
  return `${node.startPosition.row + 1}:${node.startPosition.column + 1}`;
}
