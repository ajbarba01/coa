import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Locator } from '@coa/shared';
import { webConfigSchema, type WebConfig } from './web-config.js';

/**
 * The credential-blind, user-global web-key store — the web analogue of
 * {@link AccountsRegistry}. Mostly-pure file ops over `~/.coa/web.yaml`, a
 * {@link WebConfig} of POINTERS (never secrets): each provider credential is a
 * `key-file` locator (a coa-written 0600 file under `~/.coa/keys/`) or an `env-var`
 * pointer. Backend-blind: it knows nothing about the HTTP adapters. A missing/corrupt
 * file is the strict-superset case (empty config ⇒ tools not offered). `home` is
 * injectable so tests run over a temp dir.
 */

export type WebChain = 'search' | 'fetch';

/** The provider kinds valid per chain (search has a backend Parallel can't fetch). */
export const SEARCH_KINDS = ['tavily', 'firecrawl', 'parallel'] as const;
export const FETCH_KINDS = ['firecrawl', 'tavily'] as const;

/** The user-global web config path. `home` is injectable so tests run over a temp dir. */
export function webConfigPath(home: string): string {
  return join(home, '.coa', 'web.yaml');
}

/** The 0600 key-file path for a coa-saved web key labelled `<label>`. */
export function webKeyFilePath(home: string, label: string): string {
  return join(home, '.coa', 'keys', `web-${label}`);
}

// A loosened mirror of the on-disk shape used for mutation (the enum `kind`s widen to
// `string`); `read()` re-validates every load through `webConfigSchema`, and the CLI
// validates `kind` against the chain's allowed set before calling `addCredential`.
type StoredCred = { locator: Locator; disabled: boolean };
type StoredEntry = { kind: string; disabled: boolean; credentials: StoredCred[] };
type StoredChain = { providers: StoredEntry[]; quotaCooldown: 'next-midnight' | number };
type Stored = { search?: StoredChain; fetch?: StoredChain };

export class WebConfigStore {
  readonly #home: string;

  constructor(home: string) {
    this.#home = home;
  }

  /** The validated config (drop-unknown, never-throw): a missing/corrupt file ⇒ `{}`. */
  read(): WebConfig {
    let raw: unknown;
    try {
      raw = parse(readFileSync(webConfigPath(this.#home), 'utf8'));
    } catch {
      return {};
    }
    const parsed = webConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : {};
  }

  /**
   * Append `locator` to the `kind` provider entry of `chain` (creating the chain
   * block and provider entry as needed). Rejects a kind the chain can't use.
   */
  addCredential(chain: WebChain, kind: string, locator: Locator): void {
    const allowed = chain === 'search' ? SEARCH_KINDS : FETCH_KINDS;
    if (!(allowed as readonly string[]).includes(kind)) {
      throw new Error(
        `'${kind}' is not a valid ${chain} provider (allowed: ${allowed.join(', ')})`,
      );
    }
    const config = this.#readStored();
    const block: StoredChain = config[chain] ?? { providers: [], quotaCooldown: 'next-midnight' };
    let entry = block.providers.find((p) => p.kind === kind);
    if (entry === undefined) {
      entry = { kind, disabled: false, credentials: [] };
      block.providers.push(entry);
    }
    entry.credentials.push({ locator, disabled: false });
    config[chain] = block;
    this.#write(config);
  }

  /**
   * Remove from `chain` every credential matching `id` (a key-file at
   * {@link webKeyFilePath}`(id)`, or an env-var named `id`); prune empty provider
   * entries. Returns the key-file path to unlink IFF a key-file was removed AND no
   * remaining credential in either chain still points at it (a key shared by both
   * chains survives until removed from both).
   */
  removeCredential(chain: WebChain, id: string): string[] {
    const config = this.#readStored();
    const keyFilePath = webKeyFilePath(this.#home, id);
    const isMatch = (c: StoredCred): boolean =>
      (c.locator.type === 'key-file' && c.locator.path === keyFilePath) ||
      (c.locator.type === 'env-var' && c.locator.name === id);
    let removedKeyFile = false;

    const block = config[chain];
    if (block === undefined) return [];
    block.providers = block.providers
      .map((p) => ({
        ...p,
        credentials: p.credentials.filter((c) => {
          const match = isMatch(c);
          if (match && c.locator.type === 'key-file') removedKeyFile = true;
          return !match;
        }),
      }))
      .filter((p) => p.credentials.length > 0);
    config[chain] = block;
    this.#write(config);

    if (!removedKeyFile) return [];
    const stillReferenced = [config.search, config.fetch]
      .flatMap((b) => b?.providers ?? [])
      .flatMap((p) => p.credentials)
      .some((c) => c.locator.type === 'key-file' && c.locator.path === keyFilePath);
    return stillReferenced ? [] : [keyFilePath];
  }

  /** Bench/unbench an entire provider entry (`kind`) in `chain`. A no-op if the chain or entry is absent. */
  setProviderDisabled(chain: WebChain, kind: string, disabled: boolean): void {
    const config = this.#readStored();
    const block = config[chain];
    const entry = block?.providers.find((p) => p.kind === kind);
    if (block === undefined || entry === undefined) return;
    entry.disabled = disabled;
    config[chain] = block;
    this.#write(config);
  }

  /**
   * Bench/unbench every credential in `chain` matching `id` (a key-file at
   * {@link webKeyFilePath}`(id)`, or an env-var named `id`). A no-op if the chain is
   * absent. Credential-blind: flips only the `disabled` pointer, never touches the secret.
   */
  setCredentialDisabled(chain: WebChain, id: string, disabled: boolean): void {
    const config = this.#readStored();
    const block = config[chain];
    if (block === undefined) return;
    const keyFilePath = webKeyFilePath(this.#home, id);
    for (const p of block.providers) {
      for (const c of p.credentials) {
        if (
          (c.locator.type === 'key-file' && c.locator.path === keyFilePath) ||
          (c.locator.type === 'env-var' && c.locator.name === id)
        )
          c.disabled = disabled;
      }
    }
    config[chain] = block;
    this.#write(config);
  }

  #readStored(): Stored {
    return structuredClone(this.read()) as Stored;
  }

  #write(config: Stored): void {
    const path = webConfigPath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(config), { encoding: 'utf8', mode: 0o600 });
  }
}
