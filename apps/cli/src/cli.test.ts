import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectClient,
  createDaemonCore,
  listen,
  LiveSessionRegistry,
  ModelCache,
  ModelCatalogStore,
  type RpcServer,
} from '@coa/core';
import { buildDaemonConsoleHandlers } from './console-handlers.js';
import {
  runCli,
  startDaemon,
  listMergedModels,
  listEffectiveModels,
  buildModeDeps,
} from './cli.js';

let n = 0;
function testPath(): string {
  const u = `coa-cli-${process.pid}-${Date.now()}-${n++}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${u}` : join(tmpdir(), `${u}.sock`);
}

describe('runCli — client read commands over a live daemon', () => {
  let dir: string;
  let server: RpcServer;
  let path: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'coa-cli-'));
    const handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    path = testPath();
    server = await listen(path, buildDaemonConsoleHandlers(handle, { home: dir }));
  });
  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, { path, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('cap prints the live cost state', async () => {
    const { code, out } = await run(['cap']);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ capHit: false });
  });

  it('flags prints the user feed', async () => {
    const { out } = await run(['flags']);
    expect(JSON.parse(out)).toEqual({ expanded: [], collapsed: [] });
  });

  it('an unknown command exits non-zero with an error', async () => {
    const { code, err } = await run(['frobnicate']);
    expect(code).toBe(1);
    expect(err).toMatch(/unknown/i);
  });
});

describe('startDaemon — the serve path', () => {
  it('serves the inspector reads over the bound endpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-serve-'));
    const path = testPath();
    // Root the daemon at the temp dir, not the default working directory: the reconciler
    // walks and hashes its root at startup, so leaving the default would have this test
    // scan the entire checkout and get slower every time the repo grows.
    const server = await startDaemon({
      walPath: join(dir, 'log.ndjson'),
      path,
      root: dir,
      out: () => {},
      err: () => {},
    });

    const out: string[] = [];
    const code = await runCli(['cap'], { path, out: (s) => out.push(s), err: () => {} });

    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({ capHit: false });

    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Q11: `root`/`home` used to be honored in some daemon-composition call sites and
  // bypassed (ambient `process.cwd()`/`os.homedir()`) in others. This drives real writes
  // through the live daemon over both scopes an agent save resolves (`home` for
  // personal, `root` for project) and over the auth store (`home`), then asserts nothing
  // landed in the ambient locations — a decoy `homedir()` different from the injected
  // `home`, and the real `process.cwd()`.
  it('honors an injected root/home end to end, never the ambient cwd()/homedir()', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'coa-serve-root-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'coa-serve-home-'));
    const decoyHome = mkdtempSync(join(tmpdir(), 'coa-serve-decoy-'));
    const path = testPath();
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = decoyHome;
    process.env.USERPROFILE = decoyHome;

    try {
      const server = await startDaemon({
        walPath: join(rootDir, 'log.ndjson'),
        path,
        root: rootDir,
        home: homeDir,
        out: () => {},
        err: () => {},
      });
      const client = await connectClient(path);
      try {
        const personal = await client.request('saveAgent', {
          ref: 'q11-personal',
          scope: 'personal',
          file: { name: 'Q11 personal', description: 'seam check' },
        });
        expect('error' in personal).toBe(false);
        const project = await client.request('saveAgent', {
          ref: 'q11-project',
          scope: 'project',
          file: { name: 'Q11 project', description: 'seam check' },
        });
        expect('error' in project).toBe(false);
        const cred = await client.request('addCredential', {
          providerId: 'deepseek',
          label: 'q11',
          secret: 'sk-test',
        });
        expect('error' in cred).toBe(false);
      } finally {
        await client.close();
      }
      await server.close();

      // landed where injected
      expect(existsSync(join(homeDir, '.coa', 'agents', 'q11-personal.yaml'))).toBe(true);
      expect(existsSync(join(rootDir, '.coa', 'agents', 'q11-project.yaml'))).toBe(true);
      expect(existsSync(join(homeDir, '.coa', 'keys', 'deepseek-q11'))).toBe(true);

      // never leaked to the ambient decoy homedir() or the real process.cwd()
      expect(readdirSync(decoyHome)).toEqual([]);
      expect(existsSync(join(process.cwd(), '.coa', 'agents', 'q11-personal.yaml'))).toBe(false);
      expect(existsSync(join(process.cwd(), '.coa', 'agents', 'q11-project.yaml'))).toBe(false);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(decoyHome, { recursive: true, force: true });
    }
  });
});

// F2: `startDaemon`'s `resolveMode` closure hands `buildCanUseTool` the daemon's
// ONE composition of a session's mode-aware permission deps — `session.ts`'s own
// tests only ever exercise that consumption against a FAKE `resolveMode`, so the
// actual construction (this file's `buildModeDeps`) had no coverage of its own.
// These drive it against a REAL `LiveSessionRegistry`-issued session (the exact
// class `startDaemon` wires), never a stub — the same object identity a live
// tool call's `registry.get(sessionId)` would resolve.
describe('buildModeDeps — the real resolveMode composition startDaemon wires', () => {
  it('flips the session approval seam on and binds a live getMode/hasApprovalSeam to it', () => {
    const registry = new LiveSessionRegistry();
    const { session } = registry.getOrCreate('s1', undefined, 'plan');
    // A fresh LiveSession already defaults approvalSeam to true; force it false first
    // so the assertion below can only pass if buildModeDeps genuinely set it, not
    // because it started out true.
    session.setApprovalSeam(false);

    const deps = buildModeDeps(session, 'claude');

    expect(session.approvalSeam).toBe(true);
    expect(deps.hasApprovalSeam()).toBe(true);
    expect(deps.getMode()).toBe('plan');

    // A live mid-session mode switch is reflected on the very next read — the
    // same live binding `permission.ts`'s `decideMode` relies on reading fresh.
    session.setMode('bypass');
    expect(deps.getMode()).toBe('bypass');
  });

  it('classifies with the real tool-class taxonomy, not a stub', () => {
    const registry = new LiveSessionRegistry();
    const { session } = registry.getOrCreate('s2');
    const deps = buildModeDeps(session, 'claude');

    expect(deps.classify('Read')).toBe('read');
    expect(deps.classify('Write')).toBe('write');
    expect(deps.classify('Bash')).toBe('exec');
  });

  it('requestApproval round-trips through the real LiveSession ask/answer flow', async () => {
    const registry = new LiveSessionRegistry();
    const { session } = registry.getOrCreate('s3', undefined, 'manual');
    const deps = buildModeDeps(session, 'claude');

    const pending = deps.requestApproval(
      { tool: 'Write', args: { path: 'a.txt' }, sessionId: 's3' },
      'write',
    );
    const [request] = session.pendingApprovals();
    expect(request?.tool).toBe('Write');

    session.resolveApproval(request!.requestId, 'allow');
    await expect(pending).resolves.toBe('allow');
  });
});

describe('listMergedModels — a provider that fails to fetch is logged and skipped, not cached', () => {
  it('logs the failure, contributes no models for that call, and retries (self-heals) next call', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('deepseek: no API key resolved from the account locator'))
      .mockResolvedValue([{ id: 'deepseek-chat' }]);
    const cache = new ModelCache({ fetch });
    const account = { label: 'ds', provider: 'deepseek' };
    const logged: string[] = [];

    const first = await listMergedModels(cache, [account], (line) => logged.push(line));
    expect(first).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/ds \(deepseek\) failed/);
    expect(logged[0]).toMatch(/no API key resolved/);

    const second = await listMergedModels(cache, [account], (line) => logged.push(line));
    expect(second).toEqual([{ id: 'deepseek-chat' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('listEffectiveModels', () => {
  let home: string;
  beforeEach(() => (home = mkdtempSync(join(tmpdir(), 'coa-eff-'))));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('serves the user list enriched by the live fetch, per provider', async () => {
    const store = new ModelCatalogStore(home);
    store.setHidden('claude', 'claude-haiku-3-5', true);
    const cache = {
      list: vi.fn().mockResolvedValue([{ id: 'claude-fable-5', supportsEffort: true }]),
    } as unknown as ModelCache;
    const out = await listEffectiveModels(store, cache, [{ label: 'a', provider: 'claude' }]);
    expect(out.some((m) => m.id === 'claude-haiku-3-5')).toBe(false); // hidden dropped
    expect(out.find((m) => m.id === 'claude-fable-5')?.supportsEffort).toBe(true); // enriched
    expect(out.find((m) => m.id === 'claude-sonnet-4-6')).toBeDefined(); // catalog id not in live fetch still served
  });

  it('a failed live fetch degrades to the catalog tier, never empty', async () => {
    const store = new ModelCatalogStore(home);
    const cache = { list: vi.fn().mockRejectedValue(new Error('down')) } as unknown as ModelCache;
    const out = await listEffectiveModels(
      store,
      cache,
      [{ label: 'a', provider: 'claude' }],
      () => {},
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it('an account provider with an emptied list contributes nothing (backend default)', async () => {
    const store = new ModelCatalogStore(home);
    for (const m of store.listFor('claude')) store.remove('claude', m.id);
    const cache = { list: vi.fn().mockResolvedValue([{ id: 'live' }]) } as unknown as ModelCache;
    const out = await listEffectiveModels(store, cache, [{ label: 'a', provider: 'claude' }]);
    expect(out).toEqual([]);
  });
});
