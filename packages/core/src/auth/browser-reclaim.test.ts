import { describe, expect, it } from 'vitest';
import {
  browserProfileDir,
  browserUserDataDir,
  courierPath,
  launcherPath,
  profileKey,
} from './browser-paths.js';
import { listReclaimable, reclaimProfile, trashName, type ReclaimDeps } from './browser-reclaim.js';

const HOME = 'C:\\home';
const UDD = browserUserDataDir(HOME);

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ALICE_KEY = profileKey(ALICE)!;
const BOB_KEY = profileKey(BOB)!;

interface Harness {
  deps: ReclaimDeps;
  renamed: { from: string; to: string }[];
  removed: string[];
}

/**
 * A fake profile root. `dirs` are the subdirectory names the shared user-data-dir holds;
 * `withoutMarker` are the ones that carry no `Preferences` file — Chrome's own component
 * directories, which sit right beside the jars and must never be offered for deletion.
 */
function harness(
  dirs: string[],
  options: { withoutMarker?: string[]; renameThrows?: boolean; removeThrows?: boolean } = {},
): Harness {
  const renamed: { from: string; to: string }[] = [];
  const removed: string[] = [];
  const withoutMarker = new Set(options.withoutMarker ?? []);
  return {
    renamed,
    removed,
    deps: {
      home: HOME,
      platform: 'win32',
      exists: (path) =>
        dirs.some((dir) => !withoutMarker.has(dir) && path === `${UDD}\\${dir}\\Preferences`),
      listDirs: (path) => (path === UDD ? dirs : []),
      rename: (from, to) => {
        if (options.renameThrows === true) throw new Error('EBUSY');
        renamed.push({ from, to });
      },
      remove: (path) => {
        if (options.removeThrows === true) throw new Error('EBUSY');
        removed.push(path);
      },
      now: () => 1000,
    },
  };
}

describe('listReclaimable', () => {
  it('offers a jar no account resolves to', () => {
    const { deps } = harness([ALICE_KEY, BOB_KEY]);
    expect(listReclaimable(deps, [ALICE])).toEqual([BOB_KEY]);
  });

  it('never offers a jar a live account still resolves to', () => {
    const { deps } = harness([ALICE_KEY, BOB_KEY]);
    expect(listReclaimable(deps, [ALICE, BOB])).toEqual([]);
  });

  /** One jar can back several account rows — two providers signed in as the same person
   *  (docs/adr/0021). Reclaim reaches the same directories as the removal prompt, so it
   *  applies the same guard: a shared jar never enters the list, so it cannot be offered. */
  it('never offers a jar shared by two accounts under different providers', () => {
    const { deps } = harness([ALICE_KEY]);
    expect(listReclaimable(deps, [ALICE, ALICE])).toEqual([]);
  });

  it('ignores accounts that declare no email at all', () => {
    const { deps } = harness([ALICE_KEY]);
    expect(listReclaimable(deps, [undefined, ALICE])).toEqual([]);
  });

  /** The shared root holds Chrome's own furniture beside the jars — verified 2026-07-31 that
   *  the component dirs carry no `Preferences` and every real profile directory does. */
  it('skips chrome component dirs, which carry no Preferences file', () => {
    const { deps } = harness([ALICE_KEY, 'component_crx_cache', 'GrShaderCache'], {
      withoutMarker: ['component_crx_cache', 'GrShaderCache'],
    });
    expect(listReclaimable(deps, [])).toEqual([ALICE_KEY]);
  });

  it('skips a name that could never have been a key', () => {
    const { deps } = harness([ALICE_KEY, 'Safe Browsing']);
    expect(listReclaimable(deps, [])).toEqual([ALICE_KEY]);
  });

  it('reports nothing when the profile root does not exist yet', () => {
    const { deps } = harness([]);
    expect(listReclaimable(deps, [ALICE])).toEqual([]);
  });

  it('sweeps trash a previous failed deletion left, and never lists it', () => {
    const trash = trashName(BOB_KEY, 1000);
    const { deps, removed } = harness([ALICE_KEY, trash]);
    expect(listReclaimable(deps, [ALICE])).toEqual([]);
    expect(removed).toEqual([`${UDD}\\${trash}`]);
  });

  it('survives trash that is still locked, leaving it for the next pass', () => {
    const trash = trashName(BOB_KEY, 1000);
    const { deps } = harness([trash], { removeThrows: true });
    expect(listReclaimable(deps, [])).toEqual([]);
  });
});

describe('trashName', () => {
  /** The leading dot is load-bearing: it fails `isSafeProfileKey`, so a trash name can never
   *  collide with a real key, and the lister skips it by prefix. */
  it('cannot be mistaken for a profile key', () => {
    expect(trashName(ALICE_KEY, 7).startsWith('.')).toBe(true);
  });
});

describe('reclaimProfile', () => {
  /** Renames BEFORE deleting. Measured 2026-07-31: a recursive delete of a jar whose window
   *  is open fails PARTWAY, leaving 349 files and a directory that still looks like a
   *  profile. A rename is atomic — whole, or nothing. */
  it('moves the jar aside before deleting it', () => {
    const { deps, renamed, removed } = harness([BOB_KEY]);
    reclaimProfile(deps, BOB_KEY);
    const trash = `${UDD}\\${trashName(BOB_KEY, 1000)}`;
    expect(renamed).toEqual([{ from: browserProfileDir(HOME, BOB_KEY), to: trash }]);
    expect(removed[0]).toBe(trash);
  });

  /** A profile is a triple, not a directory — the jar, the courier shim, and the relayed
   *  url. Reclaim deletes all three, exactly as `removeProfile` does. */
  it('takes the shim and the relayed url with the jar', () => {
    const { deps, removed } = harness([BOB_KEY]);
    reclaimProfile(deps, BOB_KEY);
    expect(removed).toContain(launcherPath(HOME, BOB_KEY, 'win32'));
    expect(removed).toContain(courierPath(HOME, BOB_KEY));
  });

  /** SC-1: no error channel. A jar that could not be moved is simply still there, so it
   *  appears in the list again and the user can close the browser and click once more. */
  it('leaves the whole triple alone when the jar cannot be moved', () => {
    const { deps, removed } = harness([BOB_KEY], { renameThrows: true });
    reclaimProfile(deps, BOB_KEY);
    expect(removed).toEqual([]);
    expect(listReclaimable(deps, [])).toEqual([BOB_KEY]);
  });

  /** Once the jar is moved aside it is committed to going, so a delete that fails on the
   *  trash must not strand the shim that points at a directory no longer there. */
  it('still clears the shim when the moved-aside jar cannot be deleted', () => {
    const removed: string[] = [];
    const { deps } = harness([BOB_KEY]);
    reclaimProfile(
      {
        ...deps,
        remove: (path) => {
          if (path.includes('.reclaim-')) throw new Error('EBUSY');
          removed.push(path);
        },
      },
      BOB_KEY,
    );
    expect(removed).toEqual([
      launcherPath(HOME, BOB_KEY, 'win32'),
      courierPath(HOME, BOB_KEY),
    ]);
  });

  it('refuses a key that could escape the profile root', () => {
    const { deps, renamed } = harness([BOB_KEY]);
    reclaimProfile(deps, '../../etc');
    expect(renamed).toEqual([]);
  });
});
