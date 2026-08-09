import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCoaInstallRoot } from './coa-install.js';

describe('findCoaInstallRoot', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-install-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the workspace root when starting AT it', () => {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), '');
    expect(findCoaInstallRoot(dir)).toBe(dir);
  });

  it('walks up from a nested directory to find the workspace root', () => {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), '');
    const nested = join(dir, 'apps', 'desktop', 'dist-electron', 'main');
    mkdirSync(nested, { recursive: true });
    expect(findCoaInstallRoot(nested)).toBe(dir);
  });

  it('falls back to the start directory when no workspace marker exists up to the filesystem root', () => {
    // `dir` itself (a fresh temp dir with no pnpm-workspace.yaml anywhere above it in the
    // walk, up to the OS root) has nothing to find — the honest floor is "give back what
    // you were handed", never throw.
    expect(findCoaInstallRoot(dir)).toBe(dir);
  });
});
