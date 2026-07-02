import { homedir } from 'node:os';
import { AccountsRegistry } from '@coa/core';
import type { Locator, Provider } from '@coa/shared';
import type { CliIo } from './cli.js';

/**
 * `coa auth …` — local file ops over the credential-blind account registry (no
 * daemon). Selects which Claude SUBSCRIPTION login the governed loop runs under;
 * stores pointers only. `home` is a test seam (defaults to the user's home).
 */
export function runAuthCommand(args: string[], io: CliIo, home: string = homedir()): number {
  const [sub, ...rest] = args;
  const reg = new AccountsRegistry(home);

  try {
    switch (sub) {
      case 'list': {
        const active = reg.getActive();
        const activeLabel = active.kind === 'account' ? active.account.label : 'ambient';
        for (const a of reg.list()) {
          const mark = a.label === activeLabel ? '*' : ' ';
          io.out(`${mark} ${a.label}\t${a.provider}\t${describeLocator(a.locator)}`);
        }
        return 0;
      }
      case 'current': {
        const active = reg.getActive();
        io.out(active.kind === 'account' ? active.account.label : 'ambient');
        return 0;
      }
      case 'add': {
        const [label, flag, value] = rest;
        if (label === undefined) {
          return fail(io, 'usage: coa auth add <label> --config-dir <dir> | --env-var <NAME>');
        }
        const parsed = parseAddLocator(flag, value);
        if (parsed === undefined) {
          return fail(io, 'coa auth add requires --config-dir <dir> or --env-var <NAME>');
        }
        reg.add(label, parsed.locator, parsed.provider);
        return 0;
      }
      case 'use': {
        const [target] = rest;
        if (target === undefined) return fail(io, 'usage: coa auth use <label> | ambient');
        reg.setActive(target);
        return 0;
      }
      case 'remove': {
        const [label] = rest;
        if (label === undefined) return fail(io, 'usage: coa auth remove <label>');
        reg.remove(label);
        return 0;
      }
      default:
        return fail(io, 'usage: coa auth <list|current|add|use|remove>');
    }
  } catch (err) {
    return fail(io, err instanceof Error ? err.message : 'auth command failed');
  }
}

function parseAddLocator(
  flag: string | undefined,
  value: string | undefined,
): { locator: Locator; provider: Provider } | undefined {
  if (value === undefined) return undefined;
  if (flag === '--config-dir')
    return { locator: { type: 'config-dir', dir: value }, provider: 'claude' };
  // An API-key provider (DeepSeek today) points at the env var holding its key.
  if (flag === '--env-var')
    return { locator: { type: 'env-var', name: value }, provider: 'deepseek' };
  return undefined;
}

function describeLocator(locator: Locator): string {
  switch (locator.type) {
    case 'config-dir':
      return `config-dir ${locator.dir}`;
    case 'env-var':
      return `env-var ${locator.name}`;
    case 'ambient':
      return 'ambient';
  }
}

function fail(io: CliIo, message: string): number {
  io.err(message);
  return 1;
}
