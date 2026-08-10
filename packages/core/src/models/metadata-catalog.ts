import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { modelMetadataSchema, type ModelMetadata } from '@coa/shared';
import { STATIC_MODEL_METADATA } from './metadata-static.js';
import { fetchModelsDevCatalog } from './metadata-modelsdev.js';
import { fetchOpenRouterCatalog } from './metadata-openrouter.js';
import { mergeModelMetadata } from './metadata-merge.js';

/** The user-global disk cache path — same `.coa/` home convention as `ModelCatalogStore`. */
export function modelMetadataCachePath(home: string): string {
  return join(home, '.coa', 'model-metadata-cache.json');
}

const cacheFileSchema = z.object({
  fetchedAt: z.number(),
  modelsDev: z.array(modelMetadataSchema).default([]),
  openrouter: z.array(modelMetadataSchema).default([]),
});
type CacheFile = z.infer<typeof cacheFileSchema>;

export interface ModelMetadataCatalogInit {
  home: string;
  /** Injectable transport (tests / the offline path); defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock (tests); defaults to `Date.now`. */
  now?: () => number;
}

/**
 * The model-metadata query surface: **`get(provider, id)`** / **`list(provider?)`**
 * return coa's merged view — static fallback < models.dev < OpenRouter-live (later
 * tiers override only the fields they carry; see {@link mergeModelMetadata}). Absent
 * fields on a returned row mean this catalog genuinely doesn't know — never a
 * fabricated value.
 *
 * **Construction is synchronous and does zero network I/O** — it seeds the static
 * floor plus (best-effort, drop-unknown/never-throw) whatever the last successful
 * {@link refresh} persisted to disk, so a fresh process is immediately answerable
 * offline. Call `refresh()` OFF the request path (e.g. fire-and-forget right after
 * the daemon binds) to pull live data; it never throws — a fetch failure for either
 * tier just leaves that tier's last-known-good data (or nothing, pre-first-success)
 * in place, and a `models.dev`-only or `OpenRouter`-only success still merges and
 * persists what it got.
 */
export class ModelMetadataCatalog {
  readonly #home: string;
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #now: () => number;
  #modelsDev: ModelMetadata[] = [];
  #openrouter: ModelMetadata[] = [];
  #merged = new Map<string, ModelMetadata>();

  constructor(init: ModelMetadataCatalogInit) {
    this.#home = init.home;
    this.#fetchImpl = init.fetchImpl;
    this.#now = init.now ?? Date.now;
    const cached = this.#readDiskCache();
    if (cached !== undefined) {
      this.#modelsDev = cached.modelsDev;
      this.#openrouter = cached.openrouter;
    }
    this.#rebuild();
  }

  /** This provider+id's merged metadata; `undefined` when no tier has ever heard of it. */
  get(provider: string, id: string): ModelMetadata | undefined {
    return this.#merged.get(mergeKey(provider, id));
  }

  /** Every known row, optionally filtered to one provider. */
  list(provider?: string): ModelMetadata[] {
    const all = [...this.#merged.values()];
    return provider === undefined ? all : all.filter((m) => m.provider === provider);
  }

  /**
   * Pull fresh data from models.dev and OpenRouter (in parallel, independently
   * fault-tolerant) and re-merge. Persists to disk on any success so the next
   * process start is warm. Never throws.
   */
  async refresh(opts: { modelsDev?: boolean; openrouter?: boolean } = {}): Promise<void> {
    const wantModelsDev = opts.modelsDev ?? true;
    const wantOpenRouter = opts.openrouter ?? true;
    const fetchConfig = this.#fetchImpl !== undefined ? { fetchImpl: this.#fetchImpl } : {};
    const [modelsDev, openrouter] = await Promise.all([
      wantModelsDev ? fetchModelsDevCatalog(fetchConfig) : Promise.resolve(undefined),
      wantOpenRouter ? fetchOpenRouterCatalog(fetchConfig) : Promise.resolve(undefined),
    ]);
    let changed = false;
    if (modelsDev !== undefined) {
      this.#modelsDev = modelsDev;
      changed = true;
    }
    if (openrouter !== undefined) {
      this.#openrouter = openrouter;
      changed = true;
    }
    if (!changed) return;
    this.#rebuild();
    this.#writeDiskCache();
  }

  #rebuild(): void {
    const merged = mergeModelMetadata(STATIC_MODEL_METADATA, this.#modelsDev, this.#openrouter);
    this.#merged = new Map(merged.map((m) => [mergeKey(m.provider, m.id), m] as const));
  }

  #readDiskCache(): CacheFile | undefined {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(modelMetadataCachePath(this.#home), 'utf8'));
    } catch {
      return undefined;
    }
    const parsed = cacheFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  #writeDiskCache(): void {
    const file: CacheFile = {
      fetchedAt: this.#now(),
      modelsDev: this.#modelsDev,
      openrouter: this.#openrouter,
    };
    const path = modelMetadataCachePath(this.#home);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Best-effort — a disk-cache write failure never breaks the in-memory catalog.
    }
  }
}

function mergeKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}
