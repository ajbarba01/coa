import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlagRecord, Producer, ProducerInput } from '@coa/shared';
import type { RuntimeUsage } from '@coa/spi';
import type { ChangeEventDraft } from '../event.js';
import { createSsotConstraintProducer } from '../context/ssot-constraint.js';
import { createDaemonCore, type DaemonCoreHandle } from './daemon.js';

const GOLDEN_GOOD = '__stub_good__';
const GOLDEN_BAD = '__stub_bad__';

const stubFlag = (key: string): FlagRecord => ({
  ruleId: 'stub',
  location: key,
  severity: 'med',
  message: 'm',
  fingerprint: `stub:${key}`,
  type: 2,
  confidence: 'low',
  concernKey: `stub:${key}`,
});

/** A controllable producer whose change/sweep output is whatever `state.flags` currently is. */
function stubProducer(state: { flags: FlagRecord[] }, reconciling: boolean): Producer {
  return {
    id: reconciling ? 'stub-reconciling' : 'stub-incremental',
    kind: 'deterministic',
    activation: 'on-change',
    reconciling,
    run: (input: ProducerInput) => {
      if (input.kind === 'scope' && input.scope === GOLDEN_GOOD) return [];
      if (input.kind === 'scope' && input.scope === GOLDEN_BAD) return [stubFlag('golden')];
      return state.flags;
    },
    golden: {
      good: { kind: 'scope', scope: GOLDEN_GOOD },
      bad: { kind: 'scope', scope: GOLDEN_BAD },
    },
  };
}

const hasConcern = (handle: DaemonCoreHandle, key: string): boolean =>
  handle.flags.flagsForUser().collapsed.some((c) => c.concernKey === key);

/** A minimal registered constraint (a flag producer) that emits nothing on normal runs. */
function namedConstraint(id: string): Producer {
  return {
    id,
    kind: 'deterministic',
    activation: 'manual',
    run: (input) => (input.kind === 'scope' && input.scope === GOLDEN_BAD ? [stubFlag('x')] : []),
    golden: {
      good: { kind: 'scope', scope: GOLDEN_GOOD },
      bad: { kind: 'scope', scope: GOLDEN_BAD },
    },
  };
}

/** A real single-source-of-truth producer whose target drifts from its regenerated source. */
function driftingSsotProducer() {
  const relation = { name: 'gen', source: 'src/a.ts', target: 'gen/a.ts', lang: 'typescript' };
  const runner = {
    regenerate: () => ({ kind: 'text' as const, bytes: 'export const x = 1;' }),
    readTarget: () => 'export const x = 2;',
  };
  return createSsotConstraintProducer([relation], runner).producer;
}

const MODIFY_SRC: ChangeEventDraft = {
  worktree: 'main',
  actor: 'session',
  op_id: 'op-1',
  provenance: 'declared',
  cause: null,
  kind: 'modify',
  path: 'src/a.ts',
  pre_hash: 'a',
  post_hash: 'b',
  generated: false,
};

// Every core below is rooted at this dir, and the root is not incidental: the reconciler
// baselines itself at construction by reading and hashing every git-tracked file under its
// root. Left on the default root that is the checkout this suite is running inside — several
// hundred unrelated files read and hashed per test, which is both slow enough to matter and a
// result that depends on whatever state someone's worktree happens to be in. The two tests
// that need a real repo build their own and pass it.
let dir: string;
let handle: DaemonCoreHandle | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-daemon-'));
  handle = undefined;
});
afterEach(() => {
  handle?.kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createDaemonCore', () => {
  it('constructs a working core: an open gate and a chargeable spend counter', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(handle.core.gate()).toEqual({ allow: true });
    handle.core.charge('s', 1);
    expect(handle.core.capState()).toEqual({ remaining: null, capHit: false });
  });

  it('exposes an observeChanges port on the core surface', () => {
    // Surface check only. That the port actually drives producer 2 is pinned by the
    // real-repo test below; that its absence degrades safely, by the one after that.
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(typeof handle.core.observeChanges).toBe('function');
  });

  it('records an edit to a tracked file that no governed tool made', () => {
    // The regression this pins: the reconciler seeds each tracked file's prior hash at
    // CONSTRUCTION. Build it lazily on the first tool call instead and the baseline comes
    // from already-modified disk, so the first edit to a tracked file reads as no change
    // at all — the exact case producer ② exists for. Creates still worked, which is why
    // a "does not throw" test could not catch it.
    const repo = mkdtempSync(join(tmpdir(), 'coa-recon-'));
    // The committer identity rides each command instead of being written into the repo's
    // config first. Everything this test does is spawn git, so two fewer spawns is most of
    // the way to two fewer of them being slow on a busy machine.
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.email=probe@example.com', '-c', 'user.name=probe', ...args],
        {
          cwd: repo,
          encoding: 'utf8',
        },
      );
    git('init', '-q');
    writeFileSync(join(repo, 'app.ts'), 'export const answer = 41;\n');
    git('add', 'app.ts');
    git('commit', '-qm', 'baseline');

    const seen: { kind: string; path?: string }[] = [];
    handle = createDaemonCore({ walPath: join(repo, 'log.ndjson'), root: repo });
    handle.kernel.subscribe(0, (event) => seen.push(event as { kind: string; path?: string }));

    writeFileSync(join(repo, 'app.ts'), 'export const answer = 42;\n');
    handle.core.observeChanges();

    const modified = seen.filter((d) => d.kind === 'modify' && d.path === 'app.ts');
    expect(modified).toHaveLength(1);
    rmSync(repo, { recursive: true, force: true });
  });

  it('degrades observeChanges to a no-op outside a git worktree', () => {
    // The reconciler baselines itself with `git ls-files`, which throws in a directory
    // that is not a git repo — as this temp dir is, and as any non-git project would be.
    // Producer ② is an enhancement, so its absence must never break a session.
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(() => handle?.core.observeChanges()).not.toThrow();
    expect(() => handle?.core.observeChanges()).not.toThrow();
  });

  it('checkpoints the real kernel at the session boundary', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    const before = handle.kernel.listTimeline().length;
    handle.core.checkpoint();
    expect(handle.kernel.listTimeline().length).toBe(before + 1);
  });

  it('exposes the governed tool catalogue and prompt compile for the session wiring', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(handle.core.catalogue.length).toBeGreaterThan(0);
    expect(handle.core.compile([], { allow: [], deny: [] }).prefixHead).toEqual([]);
  });

  it('binds spawn_agent to a session-scoped SpawnDeps on BOTH catalogueFor and baseCatalogueFor', async () => {
    // The trap this guards against: wiring spawn into only ONE of the two catalogues
    // would ship it dead on whichever provider reads the other (baseCatalogue is what
    // every non-claude provider gets), behind a green typecheck and a green suite.
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(handle.core.catalogueFor).toBeDefined();
    expect(handle.core.baseCatalogueFor).toBeDefined();

    const calls: Array<{ sessionId: string; agent: string }> = [];
    const spawn = {
      listAgents: () => [
        {
          ref: 'explorer',
          scope: 'builtin' as const,
          name: 'Explorer',
          description: 'x',
          icon: 'bot' as const,
          color: 'slate' as const,
        },
      ],
      startChild: (req: { agentRef: string; description: string; prompt: string }) => {
        calls.push({ sessionId: 'sess-a', agent: req.agentRef });
        return { sessionId: 'child-1' };
      },
    };

    const claudeCatalogue = handle.core.catalogueFor!('sess-a', spawn);
    const baseCatalogue = handle.core.baseCatalogueFor!('sess-a', spawn);
    const claudeTool = claudeCatalogue.find((t) => t.name === 'spawn_agent');
    const baseTool = baseCatalogue.find((t) => t.name === 'spawn_agent');
    expect(claudeTool).toBeDefined();
    expect(baseTool).toBeDefined();

    await claudeTool!.invoke({ agent: 'explorer', description: 'd', prompt: 'p' });
    await baseTool!.invoke({ agent: 'explorer', description: 'd', prompt: 'p' });

    expect(calls).toEqual([
      { sessionId: 'sess-a', agent: 'explorer' },
      { sessionId: 'sess-a', agent: 'explorer' },
    ]);
  });

  it('catalogueFor/baseCatalogueFor degrade to the unavailable branch with no spawn wired', async () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    const claudeTool = handle.core.catalogueFor!('sess-a', undefined).find(
      (t) => t.name === 'spawn_agent',
    );
    const baseTool = handle.core.baseCatalogueFor!('sess-a', undefined).find(
      (t) => t.name === 'spawn_agent',
    );
    const claudeResult = await claudeTool!.invoke({
      agent: 'explorer',
      description: 'd',
      prompt: 'p',
    });
    const baseResult = await baseTool!.invoke({ agent: 'explorer', description: 'd', prompt: 'p' });
    expect(JSON.stringify(claudeResult)).toContain('unavailable');
    expect(JSON.stringify(baseResult)).toContain('unavailable');
  });

  it('the shared catalogue/baseCatalogue are unaffected — same tool count, same names', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    const sessionScoped = handle.core.catalogueFor!('sess-a', undefined);
    expect(sessionScoped.map((t) => t.name).sort()).toEqual(
      handle.core.catalogue.map((t) => t.name).sort(),
    );
  });

  it('runs registered producers off the kernel feed so a change surfaces a flag', () => {
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      producers: [driftingSsotProducer()],
    });
    expect(handle.flags.flagsForUser('gen/a.ts').expanded).toHaveLength(0);
    handle.kernel.emit(MODIFY_SRC);
    expect(handle.flags.flagsForUser('gen/a.ts').expanded).toHaveLength(1);
  });

  it('makes the close-gate live: a fired Type-1 flag blocks the close', () => {
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      producers: [driftingSsotProducer()],
    });
    expect(handle.core.gate()).toEqual({ allow: true });
    handle.kernel.emit(MODIFY_SRC);
    expect(handle.core.gate().allow).toBe(false);
  });

  it('raises a reconciling producer’s full set at wiring time, before any change event', () => {
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      producers: [stubProducer({ flags: [stubFlag('docA')] }, true)],
    });
    expect(hasConcern(handle, 'stub:docA')).toBe(true);
  });

  it('self-heals: a flag a reconciling producer stops emitting is resolved', () => {
    const state = { flags: [stubFlag('docA')] };
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      producers: [stubProducer(state, true)],
    });
    expect(hasConcern(handle, 'stub:docA')).toBe(true);

    state.flags = [];
    handle.kernel.emit(MODIFY_SRC);
    expect(hasConcern(handle, 'stub:docA')).toBe(false);
  });

  it('reconciles per producer: a heal does not resolve another producer’s flag', () => {
    const reconciling = { flags: [stubFlag('docA')] };
    const other = createSsotConstraintProducer(
      [{ name: 'gen', source: 'src/a.ts', target: 'gen/a.ts', lang: 'typescript' }],
      { regenerate: () => ({ kind: 'text', bytes: 'x' }), readTarget: () => 'y' },
    ).producer;
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      producers: [stubProducer(reconciling, true), other],
    });
    handle.kernel.emit(MODIFY_SRC); // raises the ssot Type-1 (gen/a.ts drifts)
    expect(hasConcern(handle, 'stub:docA')).toBe(true);
    expect(handle.flags.flagsForUser('gen/a.ts').expanded).toHaveLength(1);

    reconciling.flags = []; // the reconciling producer heals
    handle.kernel.emit(MODIFY_SRC);
    expect(hasConcern(handle, 'stub:docA')).toBe(false);
    expect(handle.flags.flagsForUser('gen/a.ts').expanded).toHaveLength(1); // the other survives
  });

  it('does not diff-resolve a non-reconciling producer (append-only semantics preserved)', () => {
    const state = { flags: [stubFlag('docA')] };
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      producers: [stubProducer(state, false)],
    });
    handle.kernel.emit(MODIFY_SRC);
    expect(hasConcern(handle, 'stub:docA')).toBe(true);

    state.flags = [];
    handle.kernel.emit(MODIFY_SRC);
    expect(hasConcern(handle, 'stub:docA')).toBe(true); // stays — append-only
  });

  it('wires the dangling-governance detector live: an edge to an unregistered constraint flags', () => {
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      producers: [namedConstraint('my-rule')],
    });
    handle.kernel.assertEdge({
      from: 'docA',
      to: 'my-rule',
      type: 'governed-by',
      provenance: 'declared',
    });
    expect(hasConcern(handle, 'dangling-governance:docA→my-rule')).toBe(false);

    handle.kernel.assertEdge({
      from: 'docB',
      to: 'ghost',
      type: 'governed-by',
      provenance: 'declared',
    });
    expect(hasConcern(handle, 'dangling-governance:docB→ghost')).toBe(true);
  });

  it('self-heals a dangling-governance flag once the claim is retracted', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    handle.kernel.assertEdge({
      from: 'docB',
      to: 'ghost',
      type: 'governed-by',
      provenance: 'declared',
    });
    expect(hasConcern(handle, 'dangling-governance:docB→ghost')).toBe(true);

    handle.kernel.retractEdge('docB', 'ghost', 'governed-by');
    expect(hasConcern(handle, 'dangling-governance:docB→ghost')).toBe(false);
  });

  it('surfaces a pre-existing dangling edge at wiring via the convergence sweep', () => {
    const walPath = join(dir, 'log.ndjson');
    const first = createDaemonCore({ walPath, root: dir });
    first.kernel.assertEdge({
      from: 'docB',
      to: 'ghost',
      type: 'governed-by',
      provenance: 'declared',
    });
    first.kernel.close();

    handle = createDaemonCore({ walPath, root: dir }); // replays the edge from the WAL; no constraint registered
    expect(hasConcern(handle, 'dangling-governance:docB→ghost')).toBe(true);
  });

  it('stays inert with no producers configured (strict-superset floor)', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    handle.kernel.emit(MODIFY_SRC);
    expect(handle.core.gate()).toEqual({ allow: true });
    expect(handle.flags.flagsForUser().expanded).toHaveLength(0);
  });

  it('wires the catalogue to the real kernel: get_piece resolves a registered piece', async () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    const piece = {
      name: 'style-guide',
      description: 'd',
      body: 'b',
      axes: { delivery: 'pull', salience: 'never', provenance: 'authored' },
    } as const;
    handle.kernel.registerPiece(piece);
    const getPiece = handle.core.catalogue.find((t) => t.name === 'get_piece');
    const res = await getPiece!.invoke({ ref: 'style-guide' });
    expect(res.result).toEqual({ found: true, piece });
  });

  it('offers WebSearch/WebFetch in baseCatalogue when the injected factory yields deps', () => {
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      webTools: () => ({ searchChain: [], fetchChain: [] }),
    });
    const names = handle.core.baseCatalogue.map((t) => t.name);
    expect(names).toContain('WebSearch');
    expect(names).toContain('WebFetch');
  });

  it('omits WebSearch/WebFetch from baseCatalogue with no web-tools factory', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    const names = handle.core.baseCatalogue.map((t) => t.name);
    expect(names).not.toContain('WebSearch');
    expect(names).not.toContain('WebFetch');
  });

  it('omits them again when the factory yields nothing (an unconfigured user, never an error)', () => {
    const factory = vi.fn(() => undefined);
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir, webTools: factory });
    const names = handle.core.baseCatalogue.map((t) => t.name);
    expect(factory).toHaveBeenCalled();
    expect(names).not.toContain('WebSearch');
    expect(names).not.toContain('WebFetch');
    expect(names.length).toBeGreaterThan(0); // the rest of the catalogue is untouched
  });

  it('hands the ledger recorder to the factory; deps with no summarizer still offer WebFetch', () => {
    const recorders: Array<(usage: RuntimeUsage) => void> = [];
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      root: dir,
      webTools: ({ recordCost }) => {
        recorders.push(recordCost);
        return { searchChain: [], fetchChain: [] }; // the raw-markdown floor — no summarizer
      },
    });
    expect(recorders).toHaveLength(1);
    expect(handle.core.baseCatalogue.map((t) => t.name)).toContain('WebFetch');
    // The handed recorder reaches the live ledger without throwing.
    recorders[0]?.({ tokensIn: 1, tokensOut: 1, costUsd: 0.01 });
  });
});
