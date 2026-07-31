import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectBrowser, launcherScript } from './browser-session.js';

/** Every child process this file spawns is bounded — an unbounded `execFileSync` blocks the
 *  event loop so completely that `vi.waitFor`'s own timeout can never fire, which is the same
 *  hang class the real-browser rewrite was meant to remove (e.g. a wedged `WmiPrvSE`). */
const PS_TIMEOUT_MS = 5000;

/**
 * Proves the shim's own quoting: our generated `.cmd` re-quotes `%~1`, so a caller that
 * hands the url to a shell as ONE already-quoted command string (`"launcher" "url"`) gets it
 * through intact, ampersand and all. It does NOT prove the rented CLI quotes when it invokes
 * `BROWSER` — a caller that instead passes shell + unquoted argv loses everything after the
 * first `&` to cmd.exe's own splitting, one level above the shim, before `launch.cmd` ever
 * runs. Whether the real CLI quotes is unverified from here; that is the attended-run check
 * ADR-0018's follow-up records.
 *
 * The target is a REAL installed browser, not a `.cmd` stand-in: a batch file launched via
 * `start ""` needs its own association-resolution hop through cmd.exe, and that hop hangs in
 * a session with no interactive window station — independent of the url, independent of `&`
 * (confirmed by launching one with a plain, no-ampersand url and getting the same hang). A
 * real `.exe` has no such hop, which is exactly the shape `browserPath` always has in
 * production (`browserCandidates` only ever names chrome.exe/msedge.exe). Verification reads
 * the OS process table (`Win32_Process.CommandLine`) rather than a file the target writes
 * itself, so nothing depends on the browser's own behavior once launched — only on what
 * argument the OS says it received.
 *
 * The launch is fire-and-forget (`spawn`, not awaited): `start ""` detaches by design (the
 * CLI may be waiting on the shim), so waiting on the launcher's own exit isn't the point —
 * what the browser process actually received is. A unique marker in the url's `state` value
 * scopes both the wait and the cleanup to the instance this test spawned, never to windows
 * already open on the machine.
 *
 * Real processes and a visible browser window, so it is gated like the other live smokes:
 *
 *   COA_LIVE=1 corepack pnpm exec vitest run packages/core/src/auth/browser-launcher.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'] || process.platform !== 'win32')(
  'launcher shim round trip (win32)',
  () => {
    let marker: string | undefined;
    let dir: string | undefined;

    afterEach(() => {
      if (marker === undefined) return;
      // Best-effort: close only the instance we spawned, matched by the marker unique to
      // this run. Never a blanket kill — that would also close windows already open. The
      // browser must die before the temp dir can be removed below (its own profile files —
      // e.g. `Account Web Data` — stay locked while the process holds them open).
      try {
        const pids = execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' }).ProcessId`,
          ],
          { encoding: 'utf8', timeout: PS_TIMEOUT_MS },
        )
          .split(/\s+/)
          .filter(Boolean);
        for (const pid of pids) {
          try {
            execFileSync('taskkill', ['/F', '/PID', pid], {
              stdio: 'ignore',
              timeout: PS_TIMEOUT_MS,
            });
          } catch {
            // Already gone is fine — Chromium's own process supervision may have torn a
            // child down between the query above and this call.
          }
        }
      } catch {
        // Best-effort cleanup; a leftover window is a nuisance, never a test failure.
      }
      marker = undefined;

      if (dir !== undefined) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // Best-effort: a leftover temp dir is a nuisance, never a test failure — the
          // taskkill above may not have released every file handle yet.
        }
        dir = undefined;
      }
    });

    it('forwards an ampersand-carrying url to a real installed browser intact', async () => {
      const browserPath = detectBrowser('win32', process.env, existsSync);
      expect(
        browserPath,
        'no Chrome/Edge installed — the round trip has nothing to prove here',
      ).toBeDefined();

      dir = mkdtempSync(join(tmpdir(), 'coa-launcher-'));
      const launcher = join(dir, 'launch.cmd');
      writeFileSync(
        launcher,
        launcherScript({
          platform: 'win32',
          browserPath: browserPath!,
          profileDir: join(dir, 'profile'),
        }),
      );

      marker = `coa-live-${Date.now()}`;
      // A non-resolving domain: the assertion reads the OS process table, never waits on a
      // page load, so it proves the identical property (the `&`-carrying query string
      // arrived intact) without firing a real request at Anthropic's production auth server.
      const url = `https://example.invalid/oauth/authorize?code=1&state=${marker}&scope=user`;
      // A single pre-quoted command string, matching how a shell-invoking caller has to
      // quote to survive its own shell — not an array arg, which cmd.exe would split at `&`
      // before the shim ever sees it.
      spawn(`"${launcher}" "${url}"`, { shell: true }).on('error', () => {
        // A failed spawn just leaves nothing for vi.waitFor to find below, and that already
        // fails the test with a clear timeout — no separate handling needed.
      });

      const commandLinesWithMarker = (): string =>
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' } | Select-Object -ExpandProperty CommandLine`,
          ],
          { encoding: 'utf8', timeout: PS_TIMEOUT_MS },
        );

      await vi.waitFor(() => expect(commandLinesWithMarker()).toContain(url), {
        timeout: 15000,
        interval: 300,
      });
    });
  },
);
