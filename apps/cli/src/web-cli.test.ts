import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { webConfigPath, webKeyFilePath } from '@coa/core';
import { runWebCommand } from './web-cli.js';

let home: string;
let out: string[];
let err: string[];
const io = () => ({ out: (l: string) => out.push(l), err: (l: string) => err.push(l) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-webcli-'));
  out = [];
  err = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('runWebCommand', () => {
  it('websearch add --key writes a 0600 key file and stores only a pointer', () => {
    expect(runWebCommand('search', ['add', 'tavily', 'tv1', '--key', 'tvly-secret'], io(), home)).toBe(0);
    const keyPath = webKeyFilePath(home, 'tv1');
    expect(existsSync(keyPath)).toBe(true);
    expect(readFileSync(keyPath, 'utf8')).toBe('tvly-secret');
    const yaml = readFileSync(webConfigPath(home), 'utf8');
    expect(yaml).toContain('web-tv1'); // the pointer
    expect(yaml).not.toContain('tvly-secret'); // credential-blind — the secret is not in the config
  });

  it('rejects parallel under webfetch (search-only provider)', () => {
    expect(runWebCommand('fetch', ['add', 'parallel', 'p', '--key', 'k'], io(), home)).toBe(1);
    expect(err.join('\n')).toMatch(/not a valid fetch provider/);
    // and no key file was written for the rejected add
    expect(existsSync(webKeyFilePath(home, 'p'))).toBe(false);
  });

  it('--env-var guards a pasted key', () => {
    expect(runWebCommand('search', ['add', 'tavily', 't', '--env-var', 'tvly-oops'], io(), home)).toBe(1);
    expect(err.join('\n')).toMatch(/looks like a key/);
  });

  it('add --env-var registers an env-var pointer', () => {
    expect(runWebCommand('search', ['add', 'parallel', 'p', '--env-var', 'PARALLEL_API_KEY'], io(), home)).toBe(0);
    expect(readFileSync(webConfigPath(home), 'utf8')).toContain('PARALLEL_API_KEY');
  });

  it('list prints the provider + pointer kind, never the secret', () => {
    runWebCommand('search', ['add', 'tavily', 'tv1', '--key', 'tvly-secret'], io(), home);
    out = [];
    expect(runWebCommand('search', ['list'], io(), home)).toBe(0);
    expect(out.join('\n')).toMatch(/tavily\s+key-file/);
    expect(out.join('\n')).not.toContain('tvly-secret');
  });

  it('remove deletes the key file when no chain still references it', () => {
    runWebCommand('search', ['add', 'firecrawl', 'fc', '--key', 'fc-x'], io(), home);
    const keyPath = webKeyFilePath(home, 'fc');
    expect(existsSync(keyPath)).toBe(true);
    expect(runWebCommand('search', ['remove', 'fc'], io(), home)).toBe(0);
    expect(existsSync(keyPath)).toBe(false);
  });

  it('add requires all arguments', () => {
    expect(runWebCommand('search', ['add', 'tavily'], io(), home)).toBe(1);
    expect(err.join('\n')).toMatch(/usage/);
  });
});
