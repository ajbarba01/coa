import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  libraryStoreFileSchema,
  libraryRecordSchema,
  type LibraryDiagnostic,
  type LibraryKind,
  type LibraryRecord,
  type LibraryScope,
  type LibraryStoreFile,
} from '@coa/shared';
import { z } from 'zod';

/**
 * The declarative library stores — one per scope, each a small JSON file that
 * IS the source of truth (surfaces render it; nothing caches it): personal
 * under `<home>/.coa/library`, project under `<root>/.coa/library`. The
 * project store also materializes copied skills as real committable files
 * (`skills/<name>/SKILL.md`), the filesystem-as-database posture — a copied
 * skill is a file a human can read, diff, and commit, not a blob in a record.
 *
 * Loads are never-throw (missing file ⇒ the empty floor) and per-record: one
 * invalid record becomes a diagnostic while the rest of the store still loads.
 * Mutations are pure functions over {@link LibraryStoreFile}; the `LibraryStore`
 * class is the thin fs edge that reads/writes them.
 */

/** Where a scope's store lives. `home`/`root` are injected — never `homedir()`/`cwd()`. */
export function libraryStoreDir(home: string, root: string, scope: LibraryScope): string {
  return scope === 'personal' ? join(home, '.coa', 'library') : join(root, '.coa', 'library');
}

export function libraryStoreFilePath(dir: string): string {
  return join(dir, 'library.json');
}

/** A copied skill's materialized SKILL.md inside a store directory. */
export function copiedSkillPath(dir: string, name: string): string {
  return join(dir, 'skills', name, 'SKILL.md');
}

/** A name must be a single path segment: a copied skill's name becomes a directory. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeLibraryName(name: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`invalid library entry name: ${name}`);
}

const key = (kind: LibraryKind, name: string): string => `${kind}:${name.toLowerCase()}`;

/** Add a record. A same-(kind,name) record (case-folded) is a refusal, not an overwrite. */
export function addRecord(
  file: LibraryStoreFile,
  record: LibraryRecord,
): { ok: true; file: LibraryStoreFile } | { ok: false; error: string } {
  if (file.records.some((r) => key(r.kind, r.name) === key(record.kind, record.name))) {
    return { ok: false, error: `an entry named "${record.name}" (${record.kind}) already exists` };
  }
  return { ok: true, file: { ...file, records: [...file.records, record] } };
}

/** Replace a record in place (same (kind,name) slot) — the re-copy/re-sync path. */
export function replaceRecord(file: LibraryStoreFile, record: LibraryRecord): LibraryStoreFile {
  return {
    ...file,
    records: file.records.map((r) =>
      key(r.kind, r.name) === key(record.kind, record.name) ? record : r,
    ),
  };
}

export function findRecord(
  file: LibraryStoreFile,
  kind: LibraryKind,
  name: string,
): LibraryRecord | undefined {
  return file.records.find((r) => key(r.kind, r.name) === key(kind, name));
}

export function removeRecord(
  file: LibraryStoreFile,
  kind: LibraryKind,
  name: string,
): { file: LibraryStoreFile; removed: LibraryRecord | undefined } {
  const removed = findRecord(file, kind, name);
  if (removed === undefined) return { file, removed: undefined };
  return {
    file: { ...file, records: file.records.filter((r) => r !== removed) },
    removed,
  };
}

export function setRecordEnabled(
  file: LibraryStoreFile,
  kind: LibraryKind,
  name: string,
  enabled: boolean,
): { file: LibraryStoreFile; record: LibraryRecord | undefined } {
  const current = findRecord(file, kind, name);
  if (current === undefined) return { file, record: undefined };
  const record = { ...current, enabled };
  return { file: replaceRecord(file, record), record };
}

/** The filesystem calls the store needs, injectable so tests can run on fixture trees. */
export interface LibraryStoreIO {
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, text: string) => void;
  readonly exists: (path: string) => boolean;
  /** Recursive create. */
  readonly mkdir: (dir: string) => void;
  /** Recursive remove; a missing path is a no-op. */
  readonly removeDir: (path: string) => void;
}

export const defaultLibraryStoreIO: LibraryStoreIO = {
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  },
  exists: (path) => existsSync(path),
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  removeDir: (path) => rmSync(path, { recursive: true, force: true }),
};

const envelopeSchema = z.looseObject({
  version: z.literal(1).default(1),
  records: z.array(z.unknown()).default([]),
});

export interface LoadedStore {
  file: LibraryStoreFile;
  diagnostics: LibraryDiagnostic[];
}

const EMPTY: LibraryStoreFile = { version: 1, records: [] };

/**
 * Read one store file. Missing ⇒ the empty floor, silently. Unparseable ⇒ the
 * empty floor PLUS a diagnostic (never a throw — a broken store must not take
 * the daemon down, and must not be silently treated as empty either). Records
 * are validated one by one so a single bad record costs itself, not the store.
 */
export function loadStoreFile(
  path: string,
  scope: LibraryScope,
  io: LibraryStoreIO = defaultLibraryStoreIO,
): LoadedStore {
  if (!io.exists(path)) return { file: EMPTY, diagnostics: [] };

  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(io.readFile(path)));
  } catch (err) {
    return {
      file: EMPTY,
      diagnostics: [
        {
          path,
          scope,
          problem: 'invalid',
          detail: `store file unreadable: ${err instanceof Error ? err.message : 'unknown'}`,
        },
      ],
    };
  }

  const records: LibraryRecord[] = [];
  const diagnostics: LibraryDiagnostic[] = [];
  const seen = new Set<string>();
  for (const raw of envelope.records) {
    const parsed = libraryRecordSchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push({ path, scope, problem: 'invalid', detail: parsed.error.message });
      continue;
    }
    const k = key(parsed.data.kind, parsed.data.name);
    if (seen.has(k)) {
      diagnostics.push({
        kind: parsed.data.kind,
        name: parsed.data.name,
        path,
        scope,
        problem: 'duplicate',
        detail: `another record in this store already claims "${parsed.data.name}"`,
      });
      continue;
    }
    seen.add(k);
    records.push(parsed.data);
  }

  return { file: { version: 1, records }, diagnostics };
}

/** Write one store file — pretty-printed with a trailing newline (it is committed and diffed). */
export function saveStoreFile(
  path: string,
  file: LibraryStoreFile,
  io: LibraryStoreIO = defaultLibraryStoreIO,
): void {
  io.writeFile(path, `${JSON.stringify(libraryStoreFileSchema.parse(file), null, 2)}\n`);
}
