import { mkdtempSync, rmSync } from 'node:fs';
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
  it('current is ambient before anything is added', () => {
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toEqual(['ambient']);
  });

  it('add --config-dir then use then current', () => {
    expect(
      runAuthCommand(['add', 'work', '--config-dir', '/home/u/.claude-work'], io(), home),
    ).toBe(0);
    expect(runAuthCommand(['use', 'work'], io(), home)).toBe(0);
    out = [];
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toEqual(['work']);
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

  it('use ambient resets active', () => {
    runAuthCommand(['add', 'work', '--config-dir', '/d'], io(), home);
    runAuthCommand(['use', 'work'], io(), home);
    expect(runAuthCommand(['use', 'ambient'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['current'], io(), home);
    expect(out).toEqual(['ambient']);
  });

  it('remove drops an account', () => {
    runAuthCommand(['add', 'work', '--config-dir', '/d'], io(), home);
    expect(runAuthCommand(['remove', 'work'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out).toEqual([]);
  });
});
