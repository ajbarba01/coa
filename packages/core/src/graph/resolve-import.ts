import { posix } from 'node:path';

/**
 * Floor module resolution for the import graph. A relative specifier is resolved
 * against the importing file's directory, with the deterministic TypeScript
 * NodeNext rewrite applied: a `.js`/`.jsx`/`.mjs`/`.cjs` specifier maps to the
 * `.ts`/`.tsx`/`.mts`/`.cts` source of the same name (you must write `./b.js`
 * for a `b.ts` source). The best-guess candidate is returned when nothing is
 * indexed yet (so resolution is order-independent), or the actually-indexed
 * candidate when one exists. A bare specifier stays an external node — `tsconfig`
 * path aliases / `package.json` exports / workspace resolution are the deferred
 * precise (D144) layer, not the floor.
 */
const JS_TO_TS: Readonly<Record<string, string[]>> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const COMPLETIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'];

export function resolveImportSpecifier(
  specifier: string,
  fromPath: string,
  isKnown: (path: string) => boolean,
): string {
  if (!specifier.startsWith('.')) return specifier;
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const candidates = importCandidates(base);
  return candidates.find((c) => isKnown(c)) ?? candidates[0] ?? base;
}

/** Ordered resolution candidates for a normalized relative path; the first is the best guess. */
export function importCandidates(base: string): string[] {
  const ext = extOf(base);
  if (ext !== undefined && JS_TO_TS[ext]) {
    const stem = base.slice(0, base.length - ext.length);
    return [...JS_TO_TS[ext].map((e) => stem + e), base];
  }
  if (ext !== undefined && (TS_EXTS.has(ext) || base.endsWith('.d.ts'))) {
    return [base];
  }
  // Extensionless: complete to a source file, then a barrel index, then the bare path.
  return [
    ...COMPLETIONS.map((e) => base + e),
    ...['/index.ts', '/index.tsx', '/index.js'].map((e) => base + e),
    base,
  ];
}

function extOf(path: string): string | undefined {
  const match = path.match(/\.[cm]?[jt]sx?$/);
  return match ? match[0] : undefined;
}
