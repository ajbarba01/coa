import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  WebConfigStore,
  webKeyFilePath,
  SEARCH_KINDS,
  FETCH_KINDS,
  type WebChain,
} from '@coa/core';
import type { Locator } from '@coa/shared';
import type { CliIo } from './cli.js';

/**
 * `coa websearch …` / `coa webfetch …` — local file ops over the credential-blind
 * web-key store (no daemon). The twin of `coa auth`, split by chain: each stores
 * POINTERS in `~/.coa/web.yaml`; a `--key` writes the secret to a coa-owned 0600
 * key file under `~/.coa/keys/` (so the secret stays out of the config). `home` is a
 * test seam (defaults to the user's home).
 */
export function runWebCommand(
  chain: WebChain,
  args: string[],
  io: CliIo,
  home: string = homedir(),
): number {
  const [sub, ...rest] = args;
  const store = new WebConfigStore(home);
  const cmd = chain === 'search' ? 'websearch' : 'webfetch';

  try {
    switch (sub) {
      case 'add':
        return runAdd(chain, store, rest, io, home);
      case 'list':
        return runList(chain, store, io);
      case 'remove': {
        const [id] = rest;
        if (id === undefined) return fail(io, `usage: coa ${cmd} remove <label | env-var-name>`);
        for (const path of store.removeCredential(chain, id)) tryUnlink(path);
        return 0;
      }
      default:
        return fail(io, `usage: coa ${cmd} <add|list|remove>`);
    }
  } catch (err) {
    return fail(io, err instanceof Error ? err.message : 'web command failed');
  }
}

/** A valid POSIX/Windows environment-variable name (rejects a pasted API key). */
const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function runAdd(
  chain: WebChain,
  store: WebConfigStore,
  rest: string[],
  io: CliIo,
  home: string,
): number {
  const [provider, label, flag, value] = rest;
  const cmd = chain === 'search' ? 'websearch' : 'webfetch';
  const kinds = chain === 'search' ? SEARCH_KINDS : FETCH_KINDS;
  const usage = `usage: coa ${cmd} add <${kinds.join('|')}> <label> --key <KEY> | --env-var <NAME>`;

  if (provider === undefined || label === undefined || flag === undefined || value === undefined) {
    return fail(io, usage);
  }
  // Validate the provider BEFORE writing any key file, so a bad kind never orphans a secret.
  if (!(kinds as readonly string[]).includes(provider)) {
    return fail(io, `'${provider}' is not a valid ${chain} provider (allowed: ${kinds.join(', ')})`);
  }

  if (flag === '--key') {
    const path = writeKeyFile(home, label, value);
    store.addCredential(chain, provider, { type: 'key-file', path });
    return 0;
  }
  if (flag === '--env-var') {
    if (!ENV_VAR_NAME.test(value)) {
      return fail(
        io,
        `'${value}' looks like a key, not a variable name. To store the key itself: coa ${cmd} add ${provider} ${label} --key <KEY>. To point at an env var, pass its NAME (e.g. TAVILY_KEY_1).`,
      );
    }
    store.addCredential(chain, provider, { type: 'env-var', name: value });
    return 0;
  }
  return fail(io, usage);
}

function runList(chain: WebChain, store: WebConfigStore, io: CliIo): number {
  const config = store.read();
  const block = chain === 'search' ? config.search : config.fetch;
  for (const provider of block?.providers ?? []) {
    for (const cred of provider.credentials) {
      io.out(`${provider.kind}\t${describeLocator(cred)}`);
    }
  }
  return 0;
}

/** Write the key to `~/.coa/keys/web-<label>` (0600) and return its absolute path. */
function writeKeyFile(home: string, label: string, key: string): string {
  const path = webKeyFilePath(home, label);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key, { encoding: 'utf8', mode: 0o600 });
  return path;
}

function describeLocator(locator: Locator): string {
  switch (locator.type) {
    case 'env-var':
      return `env-var ${locator.name}`;
    case 'key-file':
      return `key-file ${locator.path}`;
    case 'config-dir':
      return `config-dir ${locator.dir}`;
    case 'ambient':
      return 'ambient';
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // best-effort cleanup — a missing key file is already the desired end state
  }
}

function fail(io: CliIo, message: string): number {
  io.err(message);
  return 1;
}
