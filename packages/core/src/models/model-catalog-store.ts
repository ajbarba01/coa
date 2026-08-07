import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  modelsFileSchema,
  type ModelEntry,
  type ModelsFile,
  type ReasoningProfile,
} from '@coa/shared';
import { defaultCatalog } from './default-catalog.js';

/** The user-global model-list path. `home` is injectable so tests run over a temp dir. */
export function modelsPath(home: string): string {
  return join(home, '.coa', 'models.yaml');
}

const EMPTY: ModelsFile = { version: 1, providers: {} };

/**
 * The editable per-provider model list — the source of truth for every place a
 * model is chosen. Reads are PURE: an untouched provider falls back to the
 * default catalog without writing (strict-superset — no file until the user
 * edits). Writes materialise first (seeding B): the first mutation persists the
 * catalog list, then mutates it, so an emptied list stays empty (a legal state,
 * distinct from never-touched). Drop-unknown / never-throw on read.
 */
export class ModelCatalogStore {
  readonly #home: string;
  constructor(home: string) {
    this.#home = home;
  }

  listFor(providerId: string): ModelEntry[] {
    return this.#read().providers[providerId] ?? defaultCatalog(providerId);
  }

  addFromDefaults(providerId: string, ids: string[]): void {
    this.#mutate(providerId, (list) => {
      const have = new Set(list.map((m) => m.id));
      const additions = defaultCatalog(providerId).filter(
        (m) => ids.includes(m.id) && !have.has(m.id),
      );
      return [...list, ...additions];
    });
  }

  addCustom(
    providerId: string,
    entry: { id: string; label?: string; reasoning?: ReasoningProfile },
  ): void {
    this.#mutate(providerId, (list) => {
      if (list.some((m) => m.id === entry.id)) return list;
      const next: ModelEntry = { id: entry.id, origin: 'custom' };
      if (entry.label !== undefined && entry.label !== '') next.label = entry.label;
      if (entry.reasoning !== undefined) next.reasoning = entry.reasoning;
      return [...list, next];
    });
  }

  edit(
    providerId: string,
    id: string,
    patch: { label?: string; reasoning?: ReasoningProfile },
  ): void {
    this.#mutate(providerId, (list) =>
      list.map((m) => {
        if (m.id !== id) return m;
        const next: ModelEntry = { ...m };
        if (patch.label !== undefined) {
          if (patch.label === '') delete next.label;
          else next.label = patch.label;
        }
        if (patch.reasoning !== undefined) {
          if (patch.reasoning.kind === 'inherit') delete next.reasoning;
          else next.reasoning = patch.reasoning;
        }
        return next;
      }),
    );
  }

  setHidden(providerId: string, id: string, hidden: boolean): void {
    this.#mutate(providerId, (list) =>
      list.map((m) => {
        if (m.id !== id) return m;
        const next: ModelEntry = { ...m };
        if (hidden) next.hidden = true;
        else delete next.hidden;
        return next;
      }),
    );
  }

  remove(providerId: string, id: string): void {
    this.#mutate(providerId, (list) => list.filter((m) => m.id !== id));
  }

  /** Materialise-then-mutate: the write path that implements seeding B. */
  #mutate(providerId: string, fn: (list: ModelEntry[]) => ModelEntry[]): void {
    const file = this.#read();
    const current = file.providers[providerId] ?? defaultCatalog(providerId);
    file.providers[providerId] = fn(current);
    this.#write(file);
  }

  #read(): ModelsFile {
    let raw: unknown;
    try {
      raw = parse(readFileSync(modelsPath(this.#home), 'utf8'));
    } catch {
      return structuredClone(EMPTY);
    }
    const parsed = modelsFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : structuredClone(EMPTY);
  }

  #write(file: ModelsFile): void {
    const path = modelsPath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(file), { encoding: 'utf8', mode: 0o600 });
  }
}
