import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { parse } from './parser.js';

/**
 * The parser isolation seam, as a separate runnable entry. In v1 `parse` runs
 * in-process and this child is kept-not-wired: the bundler emits it (a second
 * tsdown entry) so that running the tree-sitter parser as an isolated child
 * process becomes a build/runtime flag, never a re-tooling. The protocol is
 * NDJSON: one {@link parseRequestSchema} per stdin line, one serialized
 * `ParseResult` per stdout line. A native crash on a hostile file is confined to
 * this child; the host maps a lost child / unreadable line to the same
 * `{ ok:false }` failure union, so the boundary never throws across itself.
 */
const parseRequestSchema = z.object({ lang: z.string(), bytes: z.string() });

/** Pure request→response mapping (the testable core of the child protocol). */
export function handleParseRequest(line: string): string {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    return JSON.stringify({ ok: false, reason: 'crash' });
  }
  const parsed = parseRequestSchema.safeParse(request);
  if (!parsed.success) {
    return JSON.stringify({ ok: false, reason: 'crash' });
  }
  return JSON.stringify(parse(parsed.data));
}

/** The stdin→stdout driver; only runs when this module is executed directly. */
function runChild(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (line.trim().length === 0) return;
    process.stdout.write(handleParseRequest(line) + '\n');
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runChild();
}
