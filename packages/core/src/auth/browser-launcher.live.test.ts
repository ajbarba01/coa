import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserArgs, detectBrowser } from './browser-session.js';

/** Every child process this file spawns is bounded — an unbounded `execFileSync` blocks the
 *  event loop so completely that `vi.waitFor`'s own timeout can never fire, which is the same
 *  hang class the real-browser rewrite was meant to remove (e.g. a wedged `WmiPrvSE`). */
const PS_TIMEOUT_MS = 5000;

/**
 * Proves the property the redesign actually depends on: a DIRECT argv spawn of the real
 * installed browser — `spawn(command, args)`, no `shell: true` — delivers an ampersand-
 * carrying authorize url to the browser process intact. This is what {@link
 * BrowserSession.openUrl} does in production, in place of the old `BROWSER`-shim relay,
 * because that relay is what this repo proved CANNOT work: the rented CLI hands the shim a
 * POSIX-escaped url (`\"…\"`), and `cmd`'s batch argument tokenizer splits on `=`, so `%1`
 * arrives truncated at the url's first one — `\"https://…/authorize?code`
 * (docs/adr/0019). An argv array has no shell in the path to lose the quoting to,
 * which is exactly what this test checks for — and only that. It does NOT exercise
 * {@link BrowserSession.openUrl} itself (that's unit-tested with an injected `launch`), does
 * NOT touch the `BROWSER` env var or the suppressor shim, and does NOT prove anything about
 * the rented CLI's own behavior — only that the OS receives the url unmangled when coa spawns
 * argv directly.
 *
 * Verification reads the OS process table (`Win32_Process.CommandLine`) rather than a file the
 * target writes itself, so nothing depends on the browser's own behavior once launched — only
 * on what argument the OS says it received. A unique marker in the url's `state` value scopes
 * both the wait and the cleanup to the instance this test spawned, never to windows already
 * open on the machine.
 *
 * The launch is fire-and-forget (`spawn`, not awaited) and detached, matching production: the
 * caller must never block on the browser window closing.
 *
 * Real process and a visible browser window, so it is gated like the other live smokes:
 *
 *   COA_LIVE=1 corepack pnpm exec vitest run packages/core/src/auth/browser-launcher.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'] || process.platform !== 'win32')(
  'direct browser open (win32)',
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

    it('delivers an ampersand-carrying url to a directly spawned real browser intact', async () => {
      const browserPath = detectBrowser('win32', process.env, existsSync);
      expect(
        browserPath,
        'no Chrome/Edge installed — the round trip has nothing to prove here',
      ).toBeDefined();

      dir = mkdtempSync(join(tmpdir(), 'coa-launcher-'));
      marker = `coa-live-${Date.now()}`;
      // A non-resolving domain: the assertion reads the OS process table, never waits on a
      // page load, so it proves the identical property (the `&`-carrying query string
      // arrived intact) without firing a real request at Anthropic's production auth server.
      const url = `https://example.invalid/oauth/authorize?code=1&state=${marker}&scope=user`;
      const args = browserArgs(join(dir, 'profile'), url);

      // argv only — no `shell: true` — is the exact thing under test: the CLI's escaping
      // bug only exists because a shell sits between the caller and the browser. Removing
      // that hop is the whole fix.
      spawn(browserPath!, args, { detached: true, stdio: 'ignore' })
        .on('error', () => {
          // A failed spawn just leaves nothing for vi.waitFor to find below, and that
          // already fails the test with a clear timeout — no separate handling needed.
        })
        .unref();

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
