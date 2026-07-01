import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Read the persisted layout descriptor as opaque JSON. Returns `undefined` on a
 *  missing or corrupt file; the renderer validates the shape via `parseDescriptor`
 *  and falls back to its default, so persistence never throws on bad input. */
export function readLayout(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Persist the descriptor opaquely (creating its parent directory). */
export function writeLayout(file: string, descriptor: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(descriptor), 'utf8');
}
