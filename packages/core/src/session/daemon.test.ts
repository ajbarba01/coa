import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonCore, type DaemonCoreHandle } from './daemon.js';

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

  it('wires the catalogue to the real kernel: get_symbol resolves a declared symbol', async () => {
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson') });
    const record = { name: 'parseConfig', definedIn: 'src/config.ts' };
    handle.kernel.declareSymbols([record], 'src/config.ts');
    const getSymbol = handle.core.catalogue.find((t) => t.name === 'get_symbol');
    const res = await getSymbol!.invoke({ ref: { name: 'parseConfig' } });
    expect(res.result).toEqual({ found: true, symbol: record });
  });
});
