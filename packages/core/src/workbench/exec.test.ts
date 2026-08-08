import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExec } from './exec.js';

const exec = createExec(true);

describe('createExec', () => {
  it('returns stdout and a zero exit for a command that succeeds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-exec-'));
    try {
      const res = exec('echo coa-exec-ok', { cwd: dir });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('coa-exec-ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a failing command as a non-zero exit rather than a throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-exec-'));
    try {
      const res = exec('coa-no-such-command-exists', { cwd: dir });
      expect(res.exitCode).not.toBe(0);
      expect(res.stdout).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a spawn failure as a non-zero exit with the reason on stderr', () => {
    const missingShell = createExec(join(tmpdir(), 'coa-no-such-shell'));
    const res = missingShell('echo hi', { cwd: tmpdir() });
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).not.toBe('');
  });
});
