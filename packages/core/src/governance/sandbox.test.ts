import { describe, expect, it } from 'vitest';
import { DENY_READ_GLOBS, SECRETS_GLOB, sandboxPolicy } from './sandbox.js';

const worktree = '/work/main';

describe('sandboxPolicy (the per-session capability set the backend adapter enforces)', () => {
  it('denies reads of the completed secrets set, including the SDK credential home', () => {
    const set = sandboxPolicy({ sessionId: 's1', trust: 'local', worktree });
    for (const glob of DENY_READ_GLOBS) expect(set.denyRead).toContain(glob);
    expect(set.denyRead).toContain('~/.claude/**');
  });

  it('uses the one secrets glob (single-glob) in the deny-read set', () => {
    const set = sandboxPolicy({ sessionId: 's1', trust: 'local', worktree });
    expect(set.denyRead).toContain(SECRETS_GLOB);
  });

  it('adds the coa binary to the bash deny-rules (S-3 defense-in-depth)', () => {
    const set = sandboxPolicy({ sessionId: 's1', trust: 'local', worktree });
    expect(set.denyRules).toContain('Bash(coa *)');
  });

  it('sandboxes an imported (untrusted) session more strictly than a local one', () => {
    const local = sandboxPolicy({ sessionId: 's1', trust: 'local', worktree });
    const imported = sandboxPolicy({ sessionId: 's2', trust: 'imported', worktree });
    expect(local.permissionMode).not.toBe(imported.permissionMode);
  });

  it('denies the secrets set regardless of trust', () => {
    const local = sandboxPolicy({ sessionId: 's1', trust: 'local', worktree });
    const imported = sandboxPolicy({ sessionId: 's2', trust: 'imported', worktree });
    expect(imported.denyRead).toEqual(local.denyRead);
  });

  it('reflects the configured tool baseline in allowedTools', () => {
    const set = sandboxPolicy(
      { sessionId: 's1', trust: 'local', worktree },
      { allowedTools: ['get_symbol', 'edit_symbol'] },
    );
    expect(set.allowedTools).toEqual(['get_symbol', 'edit_symbol']);
  });
});
