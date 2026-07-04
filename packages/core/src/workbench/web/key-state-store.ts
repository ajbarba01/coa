import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Locator } from '@coa/shared';
import type { CooldownStore } from './routing.js';

/**
 * The persisted web-key circuit-breaker (implements {@link CooldownStore}). A
 * versioned JSON file of credential-blind cooldowns under `~/.coa/web-keys.json`,
 * mirroring the `AccountsRegistry` homedir pattern. It stores only pointer ids
 * (`${providerKind}:${locatorId}`) → `cooldownUntil` epoch-ms — never a secret.
 * fs is injectable for tests; load is drop-unknown / never-throw.
 */

/** The user-global cooldown-store path. `home` is injectable so tests run over a temp dir. */
export function webKeysPath(home: string): string {
  return join(home, '.coa', 'web-keys.json');
}

/** The credential-blind identity of a locator (env-var NAME / file path / dir), never the secret. */
export function locatorId(locator: Locator): string {
  switch (locator.type) {
    case 'env-var':
      return locator.name;
    case 'key-file':
      return locator.path;
    case 'config-dir':
      return locator.dir;
    case 'ambient':
      return 'ambient';
  }
}

const webKeysFileSchema = z
  .object({
    version: z.literal(1).default(1),
    cooldowns: z.record(z.string(), z.number()).default({}),
  })
  .strip();
type WebKeysFile = z.infer<typeof webKeysFileSchema>;

const EMPTY: WebKeysFile = { version: 1, cooldowns: {} };

export interface KeyStateStoreDeps {
  readFile: (path: string) => string;
  writeFile: (path: string, data: string) => void;
}

export class KeyStateStore implements CooldownStore {
  readonly #path: string;
  readonly #readFile: (path: string) => string;
  readonly #writeFile: (path: string, data: string) => void;

  constructor(home: string, deps?: Partial<KeyStateStoreDeps>) {
    this.#path = webKeysPath(home);
    this.#readFile = deps?.readFile ?? ((p) => readFileSync(p, 'utf8'));
    this.#writeFile =
      deps?.writeFile ??
      ((p, d) => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, d, { encoding: 'utf8', mode: 0o600 });
      });
  }

  isCoolingDown(id: string, now: number): boolean {
    const until = this.#read().cooldowns[id];
    return until !== undefined && until > now;
  }

  markCooldown(id: string, until: number): void {
    const file = this.#read();
    file.cooldowns[id] = until;
    this.#write(file);
  }

  clear(id: string): void {
    const file = this.#read();
    if (file.cooldowns[id] === undefined) return;
    delete file.cooldowns[id];
    this.#write(file);
  }

  #read(): WebKeysFile {
    let raw: unknown;
    try {
      raw = JSON.parse(this.#readFile(this.#path));
    } catch {
      return structuredClone(EMPTY);
    }
    const parsed = webKeysFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : structuredClone(EMPTY);
  }

  #write(file: WebKeysFile): void {
    this.#writeFile(this.#path, JSON.stringify(file, null, 2));
  }
}
