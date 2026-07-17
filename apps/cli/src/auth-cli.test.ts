import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAuthCommand } from './auth-cli.js';

let home: string;
let out: string[];
let err: string[];
const io = () => ({ out: (l: string) => out.push(l), err: (l: string) => err.push(l) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-authcli-'));
  out = [];
  err = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('runAuthCommand', () => {
  it('current is ambient per provider before anything is added', () => {
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toContain('claude\tambient');
    expect(out).toContain('deepseek\tambient');
  });

  it('add --config-dir then use then current shows the claude line', () => {
    expect(
      runAuthCommand(['add', 'work', '--config-dir', '/home/u/.claude-work'], io(), home),
    ).toBe(0);
    expect(runAuthCommand(['use', 'work'], io(), home)).toBe(0);
    out = [];
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toContain('claude\twork');
    expect(out).toContain('deepseek\tambient');
  });

  it('list prints registered accounts with the active marker', () => {
    runAuthCommand(['add', 'work', '--config-dir', '/home/u/.claude-work'], io(), home);
    runAuthCommand(['use', 'work'], io(), home);
    out = [];
    expect(runAuthCommand(['list'], io(), home)).toBe(0);
    expect(out.join('\n')).toMatch(/\*\s+work\b.*config-dir/);
  });

  it('add requires --config-dir', () => {
    expect(runAuthCommand(['add', 'x'], io(), home)).toBe(1);
    expect(err.join('')).toMatch(/--config-dir/);
  });

  it('use ambient resets active for all providers', () => {
    runAuthCommand(['add', 'work', '--config-dir', '/d'], io(), home);
    runAuthCommand(['use', 'work'], io(), home);
    expect(runAuthCommand(['use', 'ambient'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['current'], io(), home);
    expect(out).toContain('claude\tambient');
  });

  it('remove drops an account', () => {
    runAuthCommand(['add', 'work', '--config-dir', '/d'], io(), home);
    expect(runAuthCommand(['remove', 'work'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out).toEqual([]);
  });

  it('add --deepseek-key writes a 0600 key file and stores a key-file pointer (not the secret)', () => {
    expect(runAuthCommand(['add', 'ds', '--deepseek-key', 'sk-secret'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    // the account lists as a deepseek key-file pointer — never the key
    expect(out.join('\n')).toMatch(/ds\tdeepseek\tkey-file/);
    expect(out.join('\n')).not.toContain('sk-secret');
    // the key lives in the file coa wrote
    expect(readFileSync(join(home, '.coa', 'keys', 'ds'), 'utf8')).toBe('sk-secret');
  });

  it('add --env-var rejects a value that looks like a key, and accepts a real var name', () => {
    expect(runAuthCommand(['add', 'ds', '--env-var', 'sk-e91530'], io(), home)).toBe(1);
    expect(err.join('')).toMatch(/looks like a key/);
    err = [];
    expect(runAuthCommand(['add', 'ds', '--env-var', 'DEEPSEEK_API_KEY'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out.join('\n')).toMatch(/ds\tdeepseek\tenv-var DEEPSEEK_API_KEY/);
  });

  it('remove deletes the key file for a key-file account', () => {
    runAuthCommand(['add', 'ds', '--deepseek-key', 'sk-secret'], io(), home);
    const keyPath = join(home, '.coa', 'keys', 'ds');
    expect(existsSync(keyPath)).toBe(true);
    expect(runAuthCommand(['remove', 'ds'], io(), home)).toBe(0);
    expect(existsSync(keyPath)).toBe(false);
  });

  it('current lists longcat as ambient too', () => {
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toContain('longcat\tambient');
  });

  it('add --longcat-key writes a 0600 key file and stores a longcat key-file pointer', () => {
    expect(runAuthCommand(['add', 'lc', '--longcat-key', 'sk-secret'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out.join('\n')).toMatch(/lc\tlongcat\tkey-file/);
    expect(out.join('\n')).not.toContain('sk-secret');
    expect(readFileSync(join(home, '.coa', 'keys', 'lc'), 'utf8')).toBe('sk-secret');
  });

  it('add --longcat-env-var rejects a key-looking value and accepts a real var name', () => {
    expect(runAuthCommand(['add', 'lc', '--longcat-env-var', 'sk-e91530'], io(), home)).toBe(1);
    expect(err.join('')).toMatch(/looks like a key/);
    err = [];
    expect(runAuthCommand(['add', 'lc', '--longcat-env-var', 'LONGCAT_API_KEY'], io(), home)).toBe(
      0,
    );
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out.join('\n')).toMatch(/lc\tlongcat\tenv-var LONGCAT_API_KEY/);
  });
});
