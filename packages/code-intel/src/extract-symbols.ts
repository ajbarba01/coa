import type { CST, SymbolRecord } from '@coa/shared';
import type { SerializedNode } from './cst.js';

/**
 * Walk a parsed CST and emit byte-local per-file {@link SymbolRecord}s — the
 * byte-local half of the symbol story. M2 holds no resident table: `definedIn`
 * is an *in-file* `line:column` location (1-based), and M1 qualifies it with the
 * file path when it builds the resident table on reparse. A Tier-0 floor CST
 * (no grammar) has no named declarations, so this returns `[]` by construction.
 */
export function extractSymbols(cst: CST): SymbolRecord[] {
  const root = cst.tree as SerializedNode;
  const out: SymbolRecord[] = [];
  visit(root, [], out);
  return out;
}

interface DeclSpec {
  kind: string;
  /** Direct-child node types that hold the declared name. */
  nameTypes: readonly string[];
  /** Capture a `(params): ret` signature where the grammar affords it. */
  callable?: boolean;
  /** Push the declared name as an enclosing scope for its descendants. */
  introducesScope?: boolean;
}

const DECLARATIONS: Readonly<Record<string, DeclSpec>> = {
  function_declaration: {
    kind: 'function',
    nameTypes: ['identifier'],
    callable: true,
    introducesScope: true,
  },
  generator_function_declaration: {
    kind: 'function',
    nameTypes: ['identifier'],
    callable: true,
    introducesScope: true,
  },
  class_declaration: { kind: 'class', nameTypes: ['type_identifier'], introducesScope: true },
  abstract_class_declaration: {
    kind: 'class',
    nameTypes: ['type_identifier'],
    introducesScope: true,
  },
  interface_declaration: {
    kind: 'interface',
    nameTypes: ['type_identifier'],
    introducesScope: true,
  },
  type_alias_declaration: { kind: 'type', nameTypes: ['type_identifier'] },
  enum_declaration: { kind: 'enum', nameTypes: ['identifier'] },
  method_definition: {
    kind: 'method',
    nameTypes: ['property_identifier'],
    callable: true,
    introducesScope: true,
  },
  public_field_definition: { kind: 'field', nameTypes: ['property_identifier'] },
};

const CALLABLE_VALUE_TYPES = new Set([
  'arrow_function',
  'function_expression',
  'function',
  'generator_function',
]);

function visit(node: SerializedNode, scopeStack: readonly string[], out: SymbolRecord[]): void {
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (const declarator of node.children) {
      if (declarator.type !== 'variable_declarator') continue;
      const nameNode = firstChildOfType(declarator, ['identifier']);
      if (!nameNode) continue;
      const value = lastNamedChild(declarator);
      const callable =
        value !== undefined && value !== nameNode && CALLABLE_VALUE_TYPES.has(value.type);
      out.push(
        record(
          nameNode,
          callable ? 'function' : 'variable',
          scopeStack,
          callable ? signatureOf(value) : undefined,
        ),
      );
    }
    for (const child of node.children) visit(child, scopeStack, out);
    return;
  }

  const spec = DECLARATIONS[node.type];
  if (spec) {
    const nameNode = firstChildOfType(node, spec.nameTypes);
    if (nameNode) {
      out.push(
        record(nameNode, spec.kind, scopeStack, spec.callable ? signatureOf(node) : undefined),
      );
      const childScope = spec.introducesScope ? [...scopeStack, nameNode.text] : scopeStack;
      for (const child of node.children) visit(child, childScope, out);
      return;
    }
  }

  for (const child of node.children) visit(child, scopeStack, out);
}

function record(
  nameNode: SerializedNode,
  kind: string,
  scopeStack: readonly string[],
  signature: string | undefined,
): SymbolRecord {
  const scope = scopeStack[scopeStack.length - 1];
  return {
    name: nameNode.text,
    definedIn: `${nameNode.startPosition.row + 1}:${nameNode.startPosition.column + 1}`,
    kind,
    ...(signature !== undefined ? { signature } : {}),
    ...(scope !== undefined ? { scope } : {}),
  };
}

/** Build a `(params): ret` signature from a callable node's direct children. */
function signatureOf(node: SerializedNode): string | undefined {
  const params = node.children.find(
    (c) => c.type === 'formal_parameters' || c.type === 'parameters',
  );
  if (!params) return undefined;
  const returnType = node.children.find((c) => c.type === 'type_annotation');
  return returnType ? `${params.text}${returnType.text}` : params.text;
}

function firstChildOfType(
  node: SerializedNode,
  types: readonly string[],
): SerializedNode | undefined {
  return node.children.find((c) => types.includes(c.type));
}

function lastNamedChild(node: SerializedNode): SerializedNode | undefined {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (child?.named) return child;
  }
  return undefined;
}
