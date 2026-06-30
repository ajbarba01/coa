import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Timeline, rewindPathspec } from './checkpoint.js';

describe('Timeline', () => {
  it('records checkpoints as pointer tuples', () => {
    const timeline = new Timeline();
    const a = timeline.checkpoint(3, 'main');
    const b = timeline.checkpoint(7, 'main');
    expect(timeline.listTimeline().map((c) => c.seq)).toEqual([3, 7]);
    expect(a.id).not.toBe(b.id);
    expect(a.pinned).toBe(false);
  });

  it('computes the retention floor as the min of consumer cursors and pinned checkpoints', () => {
    const timeline = new Timeline();
    timeline.checkpoint(3, 'main');
    const pinned = timeline.checkpoint(5, 'main');
    timeline.pin(pinned.id);
    expect(timeline.retentionFloor([8])).toBe(5);
  });

  it('retains everything (floor 0) when nothing constrains it', () => {
    const timeline = new Timeline();
    timeline.checkpoint(3, 'main'); // unpinned checkpoints do not hold the floor
    expect(timeline.retentionFloor([])).toBe(0);
  });

  it('an unpin releases the floor it held', () => {
    const timeline = new Timeline();
    const cp = timeline.checkpoint(5, 'main');
    timeline.pin(cp.id);
    timeline.unpin(cp.id);
    expect(timeline.retentionFloor([8])).toBe(8);
  });
});

describe('rewindPathspec', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coa-rewind-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    writeFileSync(join(root, 'a.ts'), 'one\n');
    execFileSync('git', ['add', 'a.ts'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('re-materializes the working tree from a source ref (never rewrites history)', () => {
    writeFileSync(join(root, 'a.ts'), 'two\n');
    rewindPathspec(root, 'HEAD', ['a.ts']);
    // Normalize EOL — git autocrlf may rewrite line endings on checkout (Windows).
    expect(readFileSync(join(root, 'a.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe('one\n');
  });
});
