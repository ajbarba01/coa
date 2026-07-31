import { randomBytes } from 'node:crypto';
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
 * user-global `~/.coa/accounts.yaml` of POINTERS — never tokens. Backend-blind: it
 * knows nothing about env vars or the SDK (the locator→env mapping is the adapter's).
 *
 * The active account is tracked **per provider** (a `{ provider: label }` map), so
 * each backend has its own login and switching one never disturbs another. A missing
 * file is the strict-superset case (all providers ambient, empty list). The legacy
 * single-string `active` is migrated on read.
 */

export type ActiveAccount = { kind: 'ambient' } | { kind: 'account'; account: Account };

/** The user-global registry path. `home` is injectable so tests run over a temp dir. */
export function accountsPath(home: string): string {
  return join(home, '.coa', 'accounts.yaml');
}

const EMPTY: AccountsFile = { active: {}, accounts: [] };

/** A stable, opaque account id. Random rather than derived: an id derived from the email
 *  or label inherits their collisions and dies on a rename, and per-account side state
 *  (a browser profile) is keyed by this — see docs/adr/0018. */
export function mintAccountId(): string {
  return randomBytes(6).toString('hex');
}

export class AccountsRegistry {
  readonly #home: string;

  constructor(home: string) {
    this.#home = home;
  }

  list(): Account[] {
    return this.#read().accounts;
  }

  /** The accounts registered for one provider. */
  listByProvider(provider: Provider): Account[] {
    return this.#read().accounts.filter((a) => a.provider === provider);
  }

  /** The active account for a provider (or ambient when none is selected / it dangles). */
  getActive(provider: Provider): ActiveAccount {
    const file = this.#read();
    const label = file.active[provider];
    if (label === undefined) return { kind: 'ambient' };
    const account = file.accounts.find((a) => a.label === label && a.provider === provider);
    return account ? { kind: 'account', account } : { kind: 'ambient' };
  }

  add(
    label: string,
    locator: Locator,
    provider: Provider = 'claude',
    email?: string,
    id: string = mintAccountId(),
  ): void {
    const file = this.#read();
    if (file.accounts.some((a) => a.label === label)) {
      throw new Error(`account already exists: ${label}`);
    }
    file.accounts.push({
      label,
      provider,
      locator,
      disabled: false,
      id,
      ...(email !== undefined ? { email } : {}),
    });
    this.#write(file);
  }

  remove(label: string): void {
    const file = this.#read();
    const removed = file.accounts.find((a) => a.label === label);
    file.accounts = file.accounts.filter((a) => a.label !== label);
    if (removed !== undefined && file.active[removed.provider] === label) {
      delete file.active[removed.provider];
    }
    this.#write(file);
  }

  /** Make an account active for its own provider (inferred from the account). */
  setActive(label: string): void {
    const file = this.#read();
    const account = file.accounts.find((a) => a.label === label);
    if (account === undefined) throw new Error(`unknown account: ${label}`);
    file.active[account.provider] = label;
    this.#write(file);
  }

  /** Reset a provider to its ambient login (no account). */
  setAmbient(provider: Provider): void {
    const file = this.#read();
    delete file.active[provider];
    this.#write(file);
  }

  /** Bench/unbench an account in place — its locator, provider, and active status are untouched. */
  setDisabled(label: string, disabled: boolean): void {
    const file = this.#read();
    const index = file.accounts.findIndex((a) => a.label === label);
    const account = file.accounts[index];
    if (account === undefined) throw new Error(`unknown account: ${label}`);
    file.accounts[index] = { ...account, disabled };
    this.#write(file);
  }

  /** Set/backfill the declared email (the driven login's `--email` value). */
  setEmail(label: string, email: string): void {
    const file = this.#read();
    const index = file.accounts.findIndex((a) => a.label === label);
    const account = file.accounts[index];
    if (account === undefined) throw new Error(`unknown account: ${label}`);
    file.accounts[index] = { ...account, email };
    this.#write(file);
  }

  /** The account's id, minting and persisting one if it predates ids. `undefined` only
   *  when there is no such account. Lazy on purpose: a registry read stays a read, and
   *  an untouched legacy row is never rewritten just for being looked at. */
  ensureId(label: string): string | undefined {
    const file = this.#read();
    const index = file.accounts.findIndex((a) => a.label === label);
    const account = file.accounts[index];
    if (account === undefined) return undefined;
    if (account.id !== undefined) return account.id;
    const id = mintAccountId();
    file.accounts[index] = { ...account, id };
    this.#write(file);
    return id;
  }

  #read(): AccountsFile {
    let raw: unknown;
    try {
      raw = parse(readFileSync(accountsPath(this.#home), 'utf8'));
    } catch {
      return structuredClone(EMPTY);
    }
    return accountsFileSchema.parse(migrateActive(raw));
  }

  #write(file: AccountsFile): void {
    const path = accountsPath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(file), { encoding: 'utf8', mode: 0o600 });
  }
}

/** Migrate a legacy single-string `active` to the per-provider map (by the named account's provider). */
function migrateActive(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const file = raw as { active?: unknown; accounts?: unknown };
  if (typeof file.active !== 'string') return raw;
  if (file.active === AMBIENT) return { ...file, active: {} };
  const accounts = Array.isArray(file.accounts)
    ? (file.accounts as Array<{ label?: unknown; provider?: unknown }>)
    : [];
  const named = accounts.find((a) => a.label === file.active);
  const provider = typeof named?.provider === 'string' ? named.provider : 'claude';
  return { ...file, active: { [provider]: file.active } };
}
