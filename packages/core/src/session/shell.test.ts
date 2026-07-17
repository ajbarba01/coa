import { describe, expect, it } from 'vitest';
import { resolveShell, type ShellProbe } from './shell.js';

/** A probe whose only "existing" files are the ones named in `present`. */
function probe(overrides: Partial<ShellProbe> & { present?: readonly string[] }): ShellProbe {
  const present = new Set((overrides.present ?? []).map((p) => p.replace(/\\/g, '/')));
  return {
    platform: overrides.platform ?? 'win32',
    env: overrides.env ?? {},
    fileExists: overrides.fileExists ?? ((path) => present.has(path.replace(/\\/g, '/'))),
  };
}

describe('resolveShell', () => {
  it('uses the platform default POSIX shell off Windows without probing', () => {
    const seen: string[] = [];
    const res = resolveShell(
      probe({ platform: 'linux', fileExists: (p) => (seen.push(p), false) }),
    );
    expect(res).toEqual({ shell: true, posix: true });
    expect(seen).toEqual([]); // never touches the filesystem on POSIX
  });

  it('prefers an explicit COA_BASH_SHELL override when the file exists', () => {
    const custom = 'D:\\tools\\bash.exe';
    const res = resolveShell(probe({ env: { COA_BASH_SHELL: custom }, present: [custom] }));
    expect(res).toEqual({ shell: custom, posix: true });
  });

  it('ignores a COA_BASH_SHELL override that does not exist and falls through', () => {
    const res = resolveShell(probe({ env: { COA_BASH_SHELL: 'D:\\nope\\bash.exe' } }));
    expect(res).toEqual({ shell: true, posix: false });
  });

  it('finds Git for Windows at its default Program Files install path', () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const res = resolveShell(
      probe({ env: { ProgramFiles: 'C:\\Program Files' }, present: [bash] }),
    );
    expect(res).toEqual({ shell: bash, posix: true });
  });

  it('resolves bash from a git.exe on PATH (Git\\cmd sibling)', () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const res = resolveShell(
      probe({
        env: { PATH: 'C:\\Windows;C:\\Program Files\\Git\\cmd' },
        present: [bash],
      }),
    );
    expect(res).toEqual({ shell: bash, posix: true });
  });

  it('prefers the bin\\bash.exe wrapper over usr\\bin\\bash.exe when launched from a Git Bash PATH', () => {
    const wrapper = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const raw = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
    const res = resolveShell(
      probe({
        // A git-bash-style PATH exposes usr\bin (and its bash.exe) directly.
        env: { PATH: 'C:\\Program Files\\Git\\mingw64\\bin;C:\\Program Files\\Git\\usr\\bin' },
        present: [wrapper, raw],
      }),
    );
    expect(res).toEqual({ shell: wrapper, posix: true });
  });

  it('falls back to the platform default shell (cmd) when no bash is found on Windows', () => {
    const res = resolveShell(probe({ env: { PATH: 'C:\\Windows' } }));
    expect(res).toEqual({ shell: true, posix: false });
  });
});
