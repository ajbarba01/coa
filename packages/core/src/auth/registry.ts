import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  AMBIENT,
  accountsFileSchema,
  type Account,
  type AccountsFile,
  type Locator,
  type Provider,
} from '@coa/shared';

/**
 * The credential-blind account registry (auth core). Mostly-pure file ops over a
 * user-global `~/.coa/accounts.yaml` of POINTERS — never tokens. Backend-blind:
 * it knows nothing about env vars or the SDK (the locator→env mapping is the
 * Claude adapter's). The file is the source of truth; each mutation reads, edits,
 * and writes it. A missing file is the strict-superset case: ambient, empty list.
 */

export type ActiveAccount = { kind: 'ambient' } | { kind: 'account'; account: Account };

/** The user-global registry path. `home` is injectable so tests run over a temp dir. */
export function accountsPath(home: string): string {
  return join(home, '.coa', 'accounts.yaml');
}

const EMPTY: AccountsFile = { active: AMBIENT, accounts: [] };

export class AccountsRegistry {
  readonly #home: string;

  constructor(home: string) {
    this.#home = home;
  }

  list(): Account[] {
    return this.#read().accounts;
  }

  getActive(): ActiveAccount {
    const file = this.#read();
    if (file.active === AMBIENT) return { kind: 'ambient' };
    const account = file.accounts.find((a) => a.label === file.active);
    // A dangling active label degrades to ambient rather than throwing on read.
    return account ? { kind: 'account', account } : { kind: 'ambient' };
  }

  add(label: string, locator: Locator, provider: Provider = 'claude'): void {
    const file = this.#read();
    if (file.accounts.some((a) => a.label === label)) {
      throw new Error(`account already exists: ${label}`);
    }
    file.accounts.push({ label, provider, locator });
    this.#write(file);
  }

  remove(label: string): void {
    const file = this.#read();
    file.accounts = file.accounts.filter((a) => a.label !== label);
    if (file.active === label) file.active = AMBIENT;
    this.#write(file);
  }

  setActive(target: string): void {
    const file = this.#read();
    if (target !== AMBIENT && !file.accounts.some((a) => a.label === target)) {
      throw new Error(`unknown account: ${target}`);
    }
    file.active = target;
    this.#write(file);
  }

  #read(): AccountsFile {
    let raw: string;
    try {
      raw = readFileSync(accountsPath(this.#home), 'utf8');
    } catch {
      return structuredClone(EMPTY);
    }
    return accountsFileSchema.parse(parse(raw));
  }

  #write(file: AccountsFile): void {
    const path = accountsPath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(file), { encoding: 'utf8', mode: 0o600 });
  }
}
