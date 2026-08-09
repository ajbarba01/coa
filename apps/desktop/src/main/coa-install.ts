import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Where coa ITSELF is installed — walked up from Electron's own `process.cwd()`
 * to find `pnpm-workspace.yaml`. This is what locates the daemon's CLI binary
 * (`apps/cli/dist/bin.js`) at spawn time; it has nothing to do with which project
 * a window is GOVERNING (F11 splits these two apart — before F11 they were always
 * the same path, since coa could only govern its own checkout). Pure; never
 * throws — a start with no marker anywhere above it (up to the filesystem root)
 * falls back to `start` itself rather than raising.
 */
export function findCoaInstallRoot(start: string): string {
  for (let dir = start; ; ) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start; // hit the filesystem root — fall back to `start`
    dir = parent;
  }
}
