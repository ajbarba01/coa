import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { consoleStateSchema, type ConsoleState } from '@coa/shared';

/** The user-global console-state path. `home` is injectable so tests run over a temp dir. */
export function consoleStatePath(home: string): string {
  return join(home, '.coa', 'console.yaml');
}

const EMPTY: ConsoleState = { version: 1, addedProviders: [], disabledProviders: [], isolatedBrowserLogins: false };

export class ConsoleStateStore {
  readonly #home: string;
  constructor(home: string) { this.#home = home; }

  read(): ConsoleState {
    let raw: unknown;
    try { raw = parse(readFileSync(consoleStatePath(this.#home), 'utf8')); }
    catch { return structuredClone(EMPTY); }
    const parsed = consoleStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : structuredClone(EMPTY);
  }

  addProvider(id: string): void {
    const s = this.read();
    if (!s.addedProviders.includes(id)) { s.addedProviders.push(id); this.#write(s); }
  }

  removeProvider(id: string): void {
    const s = this.read();
    s.addedProviders = s.addedProviders.filter((p) => p !== id);
    s.disabledProviders = s.disabledProviders.filter((p) => p !== id);
    this.#write(s);
  }

  setProviderDisabled(id: string, disabled: boolean): void {
    const s = this.read();
    const has = s.disabledProviders.includes(id);
    if (disabled && !has) s.disabledProviders.push(id);
    else if (!disabled && has) s.disabledProviders = s.disabledProviders.filter((p) => p !== id);
    else return;
    this.#write(s);
  }

  #write(s: ConsoleState): void {
    const path = consoleStatePath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(s), { encoding: 'utf8', mode: 0o600 });
  }
}
