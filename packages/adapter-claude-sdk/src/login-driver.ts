import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join, posix, win32 } from 'node:path';

/**
 * The driven-login spawn on the Claude-adapter seam. coa runs Claude's OWN login
 * (`claude auth login --claudeai --email <email>`) against a managed config dir;
 * Claude opens the browser and writes the credentials itself — coa only watches
 * output and polls the status probe, staying credential-blind.
 *
 * The OAuth URL prints only on a TTY (spike fact), so the spawn prefers node-pty
 * (optional dep). Without it the flow DEGRADES, never breaks: the browser still
 * auto-opens and completion still lands via the probe poll — only the in-app
 * copy-link affordance goes dark (`ptyCaptured: false` tells the UI to say so).
 *
 * When isolated, `BROWSER` points at coa's courier shim and coa opens the profiled browser
 * itself; when not isolated, this changes nothing.
 */

/** A filesystem-safe slug for an email: lowercase, non-alphanumeric runs → '-'. */
export function emailSlug(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The managed login dir an email's account lives in. */
export function managedLoginDir(home: string, email: string): string {
  return join(home, '.coa', 'logins', emailSlug(email));
}

// eslint-disable-next-line no-control-regex -- ANSI escapes are control chars by definition
const ANSI = /\x1b\[[0-9;]*m/g;
/**
 * OSC sequences — introducer through terminator (`ESC \` or BEL), payload included.
 *
 * The CLI prints the authorize url as an OSC 8 hyperlink whenever it is on a TTY, which the
 * PTY branch always is: `ESC]8;;URL ESC\ URL ESC]8;;ESC\`. The url therefore arrives TWICE,
 * once as the link target and once as the link text, separated by a terminator that contains
 * no whitespace — so a url pattern built on `\S*` runs straight through it and captures both
 * copies plus the trailing terminator. That spliced string then rides into the launched
 * browser inside the FIRST url's `login_hint`, which is what the sign-in page fills its email
 * box from. Dropping the whole sequence leaves the link text, which is the same url, clean.
 *
 * Escape handling is load-bearing here only because coa now opens the browser from its own
 * capture rather than delegating to the CLI (docs/adr/0019).
 */
// eslint-disable-next-line no-control-regex -- ditto
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const OAUTH_URL = /https:\/\/claude\.(?:com|ai)\/\S*oauth\S*/;

/** Pure: the first OAuth authorize URL in a chunk of terminal output. */
export function extractOauthUrl(chunk: string): string | undefined {
  const match = OAUTH_URL.exec(chunk.replace(OSC, '').replace(ANSI, ''));
  return match?.[0];
}

export interface LoginProcess {
  onData(fn: (chunk: string) => void): void;
  onExit(fn: (code: number | undefined) => void): void;
  /** Forward the code-paste fallback to the CLI's "Paste code here if prompted >". */
  write(data: string): void;
  kill(): void;
  /** Whether output rides a PTY (URL capture possible) or a pipe (degraded). */
  readonly ptyCaptured: boolean;
}

const LOGIN_ARGS = (email: string): string[] => ['auth', 'login', '--claudeai', '--email', email];

/** Executable names to try, most-specific first. The native installer ships `claude.exe`
 *  and no shim, npm ships `claude.cmd` — assuming either one strands the other. */
const WIN32_NAMES = ['claude.exe', 'claude.cmd', 'claude.bat'];

/**
 * Pure: the command `spawnLogin` should launch, resolved against PATH.
 *
 * node-pty does no shell resolution — it needs a name the OS can execute directly — so a
 * wrong guess here throws and silently degrades the whole flow to the pipe branch. Falls
 * back to the bare name rather than throwing, leaving the pipe branch's `shell: true`
 * resolution a last chance (SC-1).
 */
export function resolveClaudeCommand(
  platform: string,
  pathDirs: string[],
  exists: (path: string) => boolean,
): string {
  const isWin = platform === 'win32';
  const names = isWin ? WIN32_NAMES : ['claude'];
  // Separators follow the ARGUMENT, not the host, so the function is honest about the
  // platform it was asked about (and testable for either from either).
  const joinFor = isWin ? win32.join : posix.join;
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = joinFor(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return 'claude';
}

/** `resolveClaudeCommand` bound to the real environment. */
function claudeCommand(): string {
  return resolveClaudeCommand(
    process.platform,
    (process.env['PATH'] ?? '').split(delimiter).filter((d) => d !== ''),
    existsSync,
  );
}

/**
 * Pure: the environment the login spawn runs under. `CLAUDE_CONFIG_DIR` is what keeps the
 * login inside coa's managed dir; `BROWSER` points the CLI at coa's courier shim, which
 * displaces the CLI's own open and writes down the url it was handed (docs/adr/0020). No
 * launcher ⇒ the variable is not touched at all, so an unisolated login is byte-for-byte
 * today's (D85).
 */
export function loginEnv(
  base: NodeJS.ProcessEnv,
  opts: { dir: string; browserLauncher?: string },
): NodeJS.ProcessEnv {
  return {
    ...base,
    CLAUDE_CONFIG_DIR: opts.dir,
    ...(opts.browserLauncher !== undefined ? { BROWSER: opts.browserLauncher } : {}),
  };
}

/** Spawn the driven login. Prefers a PTY; degrades to a plain pipe. When isolated,
 * the login may redirect the browser-open through `BROWSER`; this changes nothing
 * when isolation is not used. */
export function spawnLogin(opts: {
  dir: string;
  email: string;
  browserLauncher?: string;
}): LoginProcess {
  const env = loginEnv(process.env, opts);
  const dataFns: ((chunk: string) => void)[] = [];
  const exitFns: ((code: number | undefined) => void)[] = [];
  const emitData = (chunk: string): void => dataFns.forEach((fn) => fn(chunk));
  const emitExit = (code: number | undefined): void => exitFns.forEach((fn) => fn(code));

  const proc: {
    write: (d: string) => void;
    kill: () => void;
    ptyCaptured: boolean;
    /** Set by the returned handle's `kill()` when it fires before the async spawn below
     *  resolves — `import('node-pty')` (or the pipe fallback) lands on a LATER tick, so a
     *  same-tick cancel would otherwise find no process to kill yet and the child spawns
     *  anyway (an orphan). Checked once each branch installs its real `child`. */
    killed: boolean;
  } = { write: () => {}, kill: () => {}, ptyCaptured: false, killed: false };

  void (async () => {
    try {
      const pty = await import('node-pty');
      const child = pty.spawn(claudeCommand(), LOGIN_ARGS(opts.email), {
        env: env as Record<string, string>,
        cols: 120,
        rows: 30,
      });
      proc.ptyCaptured = true;
      proc.write = (d) => child.write(d);
      proc.kill = () => child.kill();
      child.onData(emitData);
      child.onExit(({ exitCode }) => emitExit(exitCode));
      if (proc.killed) child.kill();
    } catch {
      // node-pty unavailable (build failed / not installed) — degrade to a pipe.
      const child = spawn('claude', LOGIN_ARGS(opts.email), {
        env,
        shell: process.platform === 'win32',
        windowsHide: true,
      });
      proc.write = (d) => child.stdin.write(d);
      proc.kill = () => child.kill();
      child.stdout.on('data', (c: Buffer) => emitData(c.toString()));
      child.stderr.on('data', (c: Buffer) => emitData(c.toString()));
      child.on('close', (code) => emitExit(code ?? undefined));
      child.on('error', () => emitExit(undefined));
      if (proc.killed) child.kill();
    }
  })();

  return {
    onData: (fn) => dataFns.push(fn),
    onExit: (fn) => exitFns.push(fn),
    write: (d) => proc.write(d),
    kill: () => {
      proc.killed = true;
      proc.kill();
    },
    get ptyCaptured() {
      return proc.ptyCaptured;
    },
  };
}
