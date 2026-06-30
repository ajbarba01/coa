import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '@coa/shared';
import { buildScipIndex, exportScip } from './scip.js';

const symbols: SymbolRecord[] = [
  { name: 'foo', definedIn: 'src/a.ts:1:1', kind: 'function' },
  { name: 'bar', definedIn: 'src/a.ts:5:1', kind: 'function' },
  { name: 'baz', definedIn: 'src/b.ts:1:1', kind: 'class' },
];

describe('buildScipIndex (GRF-6 SCIP export)', () => {
  const index = buildScipIndex(symbols, { projectRoot: '/repo', toolVersion: '0.0.0' });

  it('carries coa tool metadata', () => {
    expect(index.metadata.toolInfo.name).toBe('coa');
    expect(index.metadata.projectRoot).toBe('/repo');
  });

  it('groups symbols into documents by file, sorted deterministically', () => {
    expect(index.documents.map((d) => d.relativePath)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(index.documents[0]?.symbols.map((s) => s.descriptor)).toEqual(['bar', 'foo']);
  });

  it('emits a human-readable string symbol id per symbol', () => {
    expect(index.documents[1]?.symbols[0]?.symbol).toBe('coa . src/b.ts . baz');
  });
});

describe('exportScip', () => {
  it('serializes the index to parseable bytes (a one-way export verb)', () => {
    const bytes = exportScip(symbols, { projectRoot: '/repo', toolVersion: '0.0.0' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as { documents: unknown[] };
    expect(parsed.documents).toHaveLength(2);
  });
});
