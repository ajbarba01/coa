import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AccountsRegistry } from '@coa/core';
import { AMBIENT, providerSchema, type Locator, type Provider } from '@coa/shared';
import type { CliIo } from './io.js';

/**
 * `coa auth …` — local file ops over the credential-blind account registry (no
 * daemon). Selects which login the governed loop runs under; stores POINTERS only.
 * A Claude account points at a subscription config dir; an API-key provider's
 * account points at either an env var (`--<provider>-env-var NAME`) or a
 * coa-written 0600 key file (`--<provider>-key KEY`, so the secret stays out of
 * `accounts.yaml`). `home` is a test seam (defaults to the user's home).
 */
export function runAuthCommand(args: string[], io: CliIo, home: string = homedir()): number {
  const [sub, ...rest] = args;
  const reg = new AccountsRegistry(home);

  try {
    switch (sub) {
      case 'list': {
        const activeLabels = activeLabelSet(reg);
        for (const a of reg.list()) {
          const mark = activeLabels.has(a.label) ? '*' : ' ';
          io.out(`${mark} ${a.label}\t${a.provider}\t${describeLocator(a.locator)}`);
        }
        return 0;
      }
      case 'current': {
        // One line per provider — the active account is tracked independently per backend.
        for (const provider of providerSchema.options) {
          const active = reg.getActive(provider);
          io.out(`${provider}\t${active.kind === 'account' ? active.account.label : 'ambient'}`);
        }
        return 0;
      }
      case 'add':
        return runAdd(reg, rest, io, home);
      case 'use': {
        const [target, provider] = rest;
        if (target === undefined) {
          return fail(io, 'usage: coa auth use <label> | ambient [provider]');
        }
        if (target === AMBIENT) {
          // `use ambient <provider>` resets that provider; `use ambient` resets all.
          if (provider !== undefined) {
            if (!isProvider(provider)) return fail(io, `unknown provider: ${provider}`);
            reg.setAmbient(provider);
          } else {
            for (const p of providerSchema.options) reg.setAmbient(p);
          }
          return 0;
        }
        reg.setActive(target);
        return 0;
      }
      case 'remove': {
        const [label] = rest;
        if (label === undefined) return fail(io, 'usage: coa auth remove <label>');
        // Drop the key file too, if this account owned one — leave no orphaned secret.
        const account = reg.list().find((a) => a.label === label);
        reg.remove(label);
        if (account?.locator.type === 'key-file') tryUnlink(account.locator.path);
        return 0;
      }
      default:
        return fail(io, 'usage: coa auth <list|current|add|use|remove>');
    }
  } catch (err) {
    return fail(io, err instanceof Error ? err.message : 'auth command failed');
  }
}

/** The API-key backends: each gets an add-time `--<provider>-key` / `--<provider>-env-var` flag pair. */
const KEYED_PROVIDERS: readonly Provider[] = ['deepseek', 'longcat', 'openai', 'openrouter'];

const ADD_USAGE =
  'usage: coa auth add <label> --config-dir <dir> | --env-var <NAME> | ' +
  '--<provider>-key <KEY> | --<provider>-env-var <NAME>' +
  ` (providers: ${KEYED_PROVIDERS.join(', ')})`;

/** A valid POSIX/Windows environment-variable name (rejects a pasted API key). */
const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function runAdd(reg: AccountsRegistry, rest: string[], io: CliIo, home: string): number {
  const [label, flag, value] = rest;
  if (label === undefined || flag === undefined || value === undefined) return fail(io, ADD_USAGE);

  if (flag === '--config-dir') {
    reg.add(label, { type: 'config-dir', dir: value }, 'claude');
    return 0;
  }
  // The original un-prefixed env-var flag, kept pointing at DeepSeek so existing
  // invocations keep working; every provider has its prefixed form below.
  if (flag === '--env-var') return addEnvVarAccount(reg, io, label, value, 'deepseek');
  for (const provider of KEYED_PROVIDERS) {
    if (flag === `--${provider}-key`) {
      const path = writeKeyFile(home, label, value);
      reg.add(label, { type: 'key-file', path }, provider);
      return 0;
    }
    if (flag === `--${provider}-env-var`) return addEnvVarAccount(reg, io, label, value, provider);
  }
  return fail(io, ADD_USAGE);
}

/** Register an env-var POINTER account, rejecting a value that looks like a pasted key. */
function addEnvVarAccount(
  reg: AccountsRegistry,
  io: CliIo,
  label: string,
  value: string,
  provider: Provider,
): number {
  if (!ENV_VAR_NAME.test(value)) {
    return fail(
      io,
      `'${value}' looks like a key, not a variable name. To store the key itself: coa auth add ${label} --${provider}-key <KEY>. To point at an env var, pass its NAME (e.g. ${provider.toUpperCase()}_API_KEY).`,
    );
  }
  reg.add(label, { type: 'env-var', name: value }, provider);
  return 0;
}

/** Write the key to `~/.coa/keys/<label>` (0600) and return its absolute path (stored in the locator). */
function writeKeyFile(home: string, label: string, key: string): string {
  const path = join(home, '.coa', 'keys', label);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key, { encoding: 'utf8', mode: 0o600 });
  return path;
}

function isProvider(value: string): value is Provider {
  return (providerSchema.options as readonly string[]).includes(value);
}

/** The set of account labels that are active for some provider (for the `*` marker). */
function activeLabelSet(reg: AccountsRegistry): Set<string> {
  const labels = new Set<string>();
  for (const provider of providerSchema.options) {
    const active = reg.getActive(provider);
    if (active.kind === 'account') labels.add(active.account.label);
  }
  return labels;
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // best-effort cleanup — a missing key file is already the desired end state
  }
}

function describeLocator(locator: Locator): string {
  switch (locator.type) {
    case 'config-dir':
      return `config-dir ${locator.dir}`;
    case 'env-var':
      return `env-var ${locator.name}`;
    case 'key-file':
      return `key-file ${locator.path}`;
    case 'ambient':
      return 'ambient';
  }
}

function fail(io: CliIo, message: string): number {
  io.err(message);
  return 1;
}
