import type { Locator, ModelDescriptor } from '@coa/shared';

/**
 * M8 — the per-account model-capability cache. Model lists (and each model's real
 * effort levels) are account-specific and low-frequency, so they are fetched once
 * per account and reused. Keyed by account label, so an account switch naturally
 * reads a different entry (no explicit invalidation needed on switch). A failed
 * fetch is not cached (the next call retries), and concurrent calls for one account
 * dedupe into a single fetch. `update` lets a session-init response seed the cache
 * opportunistically; `invalidate` forces a refetch (e.g. a manual refresh).
 *
 * The `fetch` itself is injected (it is backend-coupled — the Claude impl calls the
 * SDK's `supportedModels()`), keeping this cache a pure, backend-agnostic core unit.
 */
export interface ModelCacheAccount {
  label: string;
  locator?: Locator;
}

export interface ModelCacheDeps {
  fetch: (account: ModelCacheAccount) => Promise<ModelDescriptor[]>;
}

export class ModelCache {
  readonly #deps: ModelCacheDeps;
  readonly #cache = new Map<string, ModelDescriptor[]>();
  readonly #inflight = new Map<string, Promise<ModelDescriptor[]>>();

  constructor(deps: ModelCacheDeps) {
    this.#deps = deps;
  }

  async list(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
    const key = account.label;
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;

    const existing = this.#inflight.get(key);
    if (existing !== undefined) return existing;

    const pending = this.#deps
      .fetch(account)
      .then((models) => {
        this.#cache.set(key, models);
        return models;
      })
      .finally(() => {
        this.#inflight.delete(key);
      });
    this.#inflight.set(key, pending);
    return pending;
  }

  /** Seed the cache for an account without a fetch (e.g. from a session-init response). */
  update(label: string, models: ModelDescriptor[]): void {
    this.#cache.set(label, models);
  }

  /** Drop an account's cached entry so the next `list` refetches. */
  invalidate(label: string): void {
    this.#cache.delete(label);
  }
}
