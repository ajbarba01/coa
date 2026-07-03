import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ChangeEventDraft } from '../event.js';
import { readFileTool, glob, grep, write, edit, bash, type BaseToolDeps } from './base-tools.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** A read-only fake: an in-memory worktree at /repo. */
function readDeps(files: Record<string, string>): BaseToolDeps {
  const abs = (rel: string): string => `/repo/${rel}`;
  return {
    worktreeRoot: '/repo',
    worktree: 'main',
    readFile: (a) => {
      const rel = a.replace('/repo/', '');
      const body = files[rel];
      if (body === undefined) throw new Error(`no such file: ${a}`);
      return body;
    },
    writeFile: () => {},
    fileExists: (a) => files[a.replace('/repo/', '')] !== undefined,
    listFiles: (pattern) =>
      Object.keys(files)
        .filter((rel) => (pattern === '**/*' ? true : rel.endsWith(pattern.replace('*', ''))))
        .map(abs),
    searchFiles: ({ pattern }) =>
      Object.entries(files)
        .filter(([, body]) => body.includes(pattern))
        .map(([rel]) => ({ file: abs(rel), line: 1, text: pattern })),
    exec: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    emit: () => 0,
  };
}

describe('readFileTool', () => {
  it('returns numbered file content for a confined path', () => {
    const res = readFileTool({ path: 'src/a.ts' }, readDeps({ 'src/a.ts': 'a\nb\n' }));
    expect(res.result).toEqual({ found: true, content: '1\ta\n2\tb' });
  });

  it('rejects a path that escapes the worktree without throwing', () => {
    const res = readFileTool({ path: '../secrets' }, readDeps({}));
    expect(res.result.found).toBe(false);
    expect(res.result.reason).toBe('path-escape');
  });

  it('returns a miss (not a throw) for a missing file', () => {
    const res = readFileTool({ path: 'nope.ts' }, readDeps({}));
    expect(res.result).toEqual({ found: false, reason: 'not-found' });
  });

  it('applies offset and limit', () => {
    const res = readFileTool(
      { path: 'a', offset: 2, limit: 1 },
      readDeps({ a: 'one\ntwo\nthree\n' }),
    );
    expect(res.result.content).toBe('2\ttwo');
  });
});

describe('glob', () => {
  it('returns worktree-relative matches', () => {
    const res = glob({ pattern: '**/*' }, readDeps({ 'src/a.ts': '', 'b.ts': '' }));
    expect([...res.result.matches].sort()).toEqual(['b.ts', 'src/a.ts']);
  });

  it('rejects an escaping base path with empty matches', () => {
    const res = glob({ pattern: '*', path: '../..' }, readDeps({}));
    expect(res.result.matches).toEqual([]);
  });
});

describe('grep', () => {
  it('returns hits with worktree-relative files', () => {
    const res = grep({ pattern: 'needle' }, readDeps({ 'a.ts': 'has needle', 'b.ts': 'no' }));
    expect(res.result.hits).toEqual([{ file: 'a.ts', line: 1, text: 'needle' }]);
  });
});

/** A read/write fake that records emitted change-events. */
function rwDeps(files: Record<string, string>): {
  deps: BaseToolDeps;
  written: Record<string, string>;
  emitted: ChangeEventDraft[];
} {
  const written: Record<string, string> = {};
  const emitted: ChangeEventDraft[] = [];
  let seq = 0;
  const base = readDeps(files);
  const deps: BaseToolDeps = {
    ...base,
    writeFile: (a, b) => {
      written[a.replace('/repo/', '')] = b;
    },
    emit: (draft) => {
      emitted.push(draft);
      return seq++;
    },
  };
  return { deps, written, emitted };
}

describe('write', () => {
  it('creates a new file and emits a create change-event', () => {
    const { deps, written, emitted } = rwDeps({});
    const res = write({ path: 'new.ts', content: 'hello\n' }, deps);
    expect(res.result).toEqual({ applied: true, path: 'new.ts', seq: 0, created: true });
    expect(written['new.ts']).toBe('hello\n');
    expect(emitted[0]).toMatchObject({ kind: 'create', path: 'new.ts', pre_hash: null, post_hash: sha256('hello\n') });
  });

  it('overwrites an existing file and emits a modify change-event', () => {
    const { deps, emitted } = rwDeps({ 'a.ts': 'old\n' });
    const res = write({ path: 'a.ts', content: 'new\n' }, deps);
    expect(res.result).toMatchObject({ applied: true, created: false });
    expect(emitted[0]).toMatchObject({ kind: 'modify', pre_hash: sha256('old\n'), post_hash: sha256('new\n') });
  });

  it('rejects an escaping path without throwing', () => {
    const { deps } = rwDeps({});
    const res = write({ path: '../x', content: 'y' }, deps);
    expect(res.result).toEqual({ applied: false, error: { code: 'path-escape', message: expect.any(String) } });
  });

  it('returns an unapplied result when the disk write throws (does not throw)', () => {
    const { deps } = rwDeps({});
    const throwingDeps: BaseToolDeps = {
      ...deps,
      writeFile: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    let res: ReturnType<typeof write> | undefined;
    expect(() => {
      res = write({ path: 'new.ts', content: 'hello\n' }, throwingDeps);
    }).not.toThrow();
    expect(res?.result).toEqual({
      applied: false,
      error: { code: 'write-failed', message: expect.any(String) },
    });
  });

  it('returns an unapplied result when reading an existing file to overwrite throws', () => {
    const { deps } = rwDeps({ 'a.ts': 'old\n' });
    const throwingDeps: BaseToolDeps = {
      ...deps,
      readFile: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    let res: ReturnType<typeof write> | undefined;
    expect(() => {
      res = write({ path: 'a.ts', content: 'new\n' }, throwingDeps);
    }).not.toThrow();
    expect(res?.result.applied).toBe(false);
  });
});

describe('edit', () => {
  it('applies a unique replacement and emits a modify event', () => {
    const { deps, written, emitted } = rwDeps({ 'a.ts': 'const x = 1;\n' });
    const res = edit({ path: 'a.ts', old_string: '1', new_string: '2' }, deps);
    expect(res.result).toMatchObject({ applied: true, path: 'a.ts' });
    expect(written['a.ts']).toBe('const x = 2;\n');
    expect(emitted).toHaveLength(1);
  });

  it('returns an unapplied result when old_string is not found', () => {
    const { deps } = rwDeps({ 'a.ts': 'abc' });
    const res = edit({ path: 'a.ts', old_string: 'zzz', new_string: 'y' }, deps);
    expect(res.result).toEqual({ applied: false, error: { code: 'edit-no-match', message: expect.any(String) } });
  });

  it('returns an unapplied result when old_string is ambiguous and replace_all is false', () => {
    const { deps } = rwDeps({ 'a.ts': 'x x' });
    const res = edit({ path: 'a.ts', old_string: 'x', new_string: 'y' }, deps);
    expect(res.result).toMatchObject({ applied: false, error: { code: 'edit-ambiguous' } });
  });

  it('replaces every occurrence when replace_all is true', () => {
    const { deps, written } = rwDeps({ 'a.ts': 'x x' });
    const res = edit({ path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: true }, deps);
    expect(res.result).toMatchObject({ applied: true });
    expect(written['a.ts']).toBe('y y');
  });

  it('returns an unapplied result when the disk write throws after a successful match (does not throw)', () => {
    const { deps } = rwDeps({ 'a.ts': 'const x = 1;\n' });
    const throwingDeps: BaseToolDeps = {
      ...deps,
      writeFile: () => {
        throw new Error('ENOSPC: no space left on device');
      },
    };
    let res: ReturnType<typeof edit> | undefined;
    expect(() => {
      res = edit({ path: 'a.ts', old_string: '1', new_string: '2' }, throwingDeps);
    }).not.toThrow();
    expect(res?.result).toEqual({
      applied: false,
      error: { code: 'write-failed', message: expect.any(String) },
    });
  });
});

describe('bash', () => {
  it('runs a command with cwd = worktreeRoot and returns its result', () => {
    let seenCwd = '';
    const deps: BaseToolDeps = {
      ...readDeps({}),
      exec: (command, opts) => {
        seenCwd = opts.cwd;
        return { stdout: `ran ${command}`, stderr: '', exitCode: 0 };
      },
    };
    const res = bash({ command: 'ls' }, deps);
    expect(seenCwd).toBe('/repo');
    expect(res.result).toEqual({ stdout: 'ran ls', stderr: '', exitCode: 0 });
  });

  it('surfaces a non-zero exit as a normal result (never throws)', () => {
    const deps: BaseToolDeps = {
      ...readDeps({}),
      exec: () => ({ stdout: '', stderr: 'boom', exitCode: 1 }),
    };
    const res = bash({ command: 'false' }, deps);
    expect(res.result).toEqual({ stdout: '', stderr: 'boom', exitCode: 1 });
  });

  it('passes the timeout through to exec', () => {
    let seenTimeout: number | undefined;
    const deps: BaseToolDeps = {
      ...readDeps({}),
      exec: (_c, opts) => {
        seenTimeout = opts.timeoutMs;
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    bash({ command: 'sleep 1', timeout: 5000 }, deps);
    expect(seenTimeout).toBe(5000);
  });
});
