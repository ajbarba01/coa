import type { GenerationRelation, GenerationRunner, RegenOutput } from './ssot-constraint.js';
import type { GenerationEntry } from './generate-config.js';

/**
 * M4 / L-GEN (GEN-2) — a concrete {@link GenerationRunner} that orchestrates the
 * declared generators (P8 — it never reimplements codegen). Per relation it runs
 * the pinned `command` through the injected {@link GenerationIo} exec port in a
 * **fixed environment** (GEN-8 (c): `C`/`UTF-8` locale, `UTC`, a pinned
 * `SOURCE_DATE_EPOCH`) so environment leakage cannot manufacture false drift,
 * captures stdout, and decodes it as text — or, when the output carries a NUL
 * byte, reports it as non-canonicalizable **binary** (GEN-8 (d) → `origin_anchor`,
 * never a byte-diff). `readTarget` reads the checked-in copy through the same port.
 *
 * This is the **minimal** runnable half: the exec port owns the working directory
 * and child-process mechanics (the app side maps it to `execFileSync`/`readFileSync`
 * rooted at the worktree). Deferred to a later pass: temp-dir output isolation,
 * topological DAG ordering, generator-version *enforcement* (the pin is carried but
 * the command is responsible for invoking it), and the idle/debounce scheduler.
 */

/** The injected side-effect port — run a generator command, and read a target's bytes. */
export interface GenerationIo {
  /** Run `command` with `env` overlaid on a fixed base; return its raw stdout. */
  exec(command: string, env: Record<string, string>): Buffer;
  /** Read the bytes currently checked in at `path` (a repo-relative target). */
  readFile(path: string): Buffer;
}

/** GEN-8 (c) — the fixed regenerate environment that pins out locale/time/path leakage. */
const FIXED_ENV: Record<string, string> = {
  LC_ALL: 'C',
  LANG: 'C.UTF-8',
  TZ: 'UTC',
  SOURCE_DATE_EPOCH: '315532800',
};

export function createGenerationRunner(
  entries: readonly GenerationEntry[],
  io: GenerationIo,
): GenerationRunner {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  return {
    regenerate(relation: GenerationRelation): RegenOutput {
      const entry = byName.get(relation.name);
      if (entry === undefined) {
        throw new Error(`no generation entry for relation "${relation.name}"`);
      }
      const stdout = io.exec(entry.command, { ...FIXED_ENV });
      if (stdout.includes(0)) return { kind: 'binary' };
      return { kind: 'text', bytes: stdout.toString('utf8') };
    },
    readTarget(relation: GenerationRelation): string {
      return io.readFile(relation.target).toString('utf8');
    },
  };
}
