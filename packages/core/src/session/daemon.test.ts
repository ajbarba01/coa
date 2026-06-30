import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeEventDraft } from '../event.js';
import { createSsotConstraintProducer } from '../context/ssot-constraint.js';
import { createDaemonCore, type DaemonCoreHandle } from './daemon.js';

/** A real M4 SSOT producer whose target drifts from its regenerated source. */
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
  it('constructs a working core: an open gate and a chargeable cap', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), ceilingUsd: 1 });
    expect(handle.core.gate()).toEqual({ allow: true });
    handle.core.charge('s', 1);
    expect(handle.core.capState().capHit).toBe(true);
  });

  it('is unbounded under the subscription model (no ceiling)', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson') });
    expect(handle.core.capState()).toEqual({ remaining: null, capHit: false });
  });

  it('checkpoints the real kernel at the session boundary', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson') });
    const before = handle.kernel.listTimeline().length;
    handle.core.checkpoint();
    expect(handle.kernel.listTimeline().length).toBe(before + 1);
  });

  it('exposes the M6 catalogue and M5 compile for the session wiring', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson') });
    expect(handle.core.catalogue.length).toBeGreaterThan(0);
    expect(handle.core.compile([], { allow: [], deny: [] }).prefixHead).toEqual([]);
  });

  it('runs registered producers off the kernel feed so a change surfaces a flag (R-3)', () => {
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      producers: [driftingSsotProducer()],
    });
    expect(handle.flags.flagsForUser('gen/a.ts').expanded).toHaveLength(0);
    handle.kernel.emit(MODIFY_SRC);
    expect(handle.flags.flagsForUser('gen/a.ts').expanded).toHaveLength(1);
  });

  it('makes the close-gate live: a fired Type-1 flag blocks the close (R-3)', () => {
    handle = createDaemonCore({
      walPath: join(dir, 'log.ndjson'),
      producers: [driftingSsotProducer()],
    });
    expect(handle.core.gate()).toEqual({ allow: true });
    handle.kernel.emit(MODIFY_SRC);
    expect(handle.core.gate().allow).toBe(false);
  });

  it('stays inert with no producers configured (strict-superset floor)', () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson') });
    handle.kernel.emit(MODIFY_SRC);
    expect(handle.core.gate()).toEqual({ allow: true });
    expect(handle.flags.flagsForUser().expanded).toHaveLength(0);
  });

  it('wires the catalogue to the real kernel: get_symbol resolves a declared symbol', async () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson') });
    const record = { name: 'parseConfig', definedIn: 'src/config.ts' };
    handle.kernel.declareSymbols([record], 'src/config.ts');
    const getSymbol = handle.core.catalogue.find((t) => t.name === 'get_symbol');
    const res = await getSymbol!.invoke({ ref: { name: 'parseConfig' } });
    expect(res.result).toEqual({ found: true, symbol: record });
  });
});
