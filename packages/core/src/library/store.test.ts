import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LibraryRecord, LibraryStoreFile } from '@coa/shared';
import {
  addRecord,
  findRecord,
  libraryStoreDir,
  libraryStoreFilePath,
  loadStoreFile,
  removeRecord,
  saveStoreFile,
  setRecordEnabled,
} from './store.js';

const ref = (name: string, kind: LibraryRecord['kind'] = 'skill'): LibraryRecord => ({
  name,
  kind,
  mode: 'reference',
  enabled: true,
  source: { path: `/src/${name}/SKILL.md`, ...(kind === 'mcp' ? { serverName: name } : {}) },
});

const empty: LibraryStoreFile = { version: 1, records: [] };

describe('store mutations (pure)', () => {
  it('adds a record and refuses a case-folded duplicate of the same kind', () => {
    const one = addRecord(empty, ref('commits'));
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const dup = addRecord(one.file, ref('COMMITS'));
    expect(dup.ok).toBe(false);
    expect(empty.records).toEqual([]); // pure — the input was not touched
  });

  it('lets a skill and an mcp server share a name — kind is part of identity', () => {
    const one = addRecord(empty, ref('github'));
    if (!one.ok) throw new Error('unexpected');
    expect(addRecord(one.file, ref('github', 'mcp')).ok).toBe(true);
  });

  it('removes by (kind, name) and reports a miss as removed: undefined', () => {
    const one = addRecord(empty, ref('commits'));
    if (!one.ok) throw new Error('unexpected');
    expect(removeRecord(one.file, 'skill', 'commits').removed?.name).toBe('commits');
    expect(removeRecord(one.file, 'mcp', 'commits').removed).toBeUndefined();
    expect(removeRecord(empty, 'skill', 'ghost').removed).toBeUndefined();
  });

  it('flips enabled without touching anything else', () => {
    const one = addRecord(empty, ref('commits'));
    if (!one.ok) throw new Error('unexpected');
    const { file, record } = setRecordEnabled(one.file, 'skill', 'commits', false);
    expect(record?.enabled).toBe(false);
    expect(findRecord(file, 'skill', 'commits')?.enabled).toBe(false);
    expect(findRecord(one.file, 'skill', 'commits')?.enabled).toBe(true); // input untouched
  });
});

describe('loadStoreFile / saveStoreFile', () => {
  const tempStore = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-libstore-'));
    return libraryStoreFilePath(dir);
  };

  it('round-trips a saved store', () => {
    const path = tempStore();
    const added = addRecord(empty, ref('commits'));
    if (!added.ok) throw new Error('unexpected');
    saveStoreFile(path, added.file);
    const loaded = loadStoreFile(path, 'project');
    expect(loaded.file).toEqual(added.file);
    expect(loaded.diagnostics).toEqual([]);
  });

  it('is the empty floor when the file does not exist', () => {
    const loaded = loadStoreFile(join(tmpdir(), 'coa-absent', 'library.json'), 'personal');
    expect(loaded.file.records).toEqual([]);
    expect(loaded.diagnostics).toEqual([]);
  });

  it('turns an unreadable store file into a diagnostic, never a throw', () => {
    const path = tempStore();
    saveStoreFile(path, empty);
    const io = {
      readFile: () => 'not json at all',
      writeFile: () => {},
      exists: () => true,
      mkdir: () => {},
      removeDir: () => {},
    };
    const loaded = loadStoreFile(path, 'project', io);
    expect(loaded.file.records).toEqual([]);
    expect(loaded.diagnostics[0]?.problem).toBe('invalid');
  });

  it('costs one bad record its slot, not the store', () => {
    const path = tempStore();
    const text = JSON.stringify({
      version: 1,
      records: [ref('good'), { name: 'bad', kind: 'skill', mode: 'copy' }],
    });
    const io = {
      readFile: () => text,
      writeFile: () => {},
      exists: () => true,
      mkdir: () => {},
      removeDir: () => {},
    };
    const loaded = loadStoreFile(path, 'project', io);
    expect(loaded.file.records.map((r) => r.name)).toEqual(['good']);
    expect(loaded.diagnostics).toHaveLength(1);
  });

  it('reports an in-file duplicate and keeps the first', () => {
    const text = JSON.stringify({ version: 1, records: [ref('twice'), ref('TWICE')] });
    const io = {
      readFile: () => text,
      writeFile: () => {},
      exists: () => true,
      mkdir: () => {},
      removeDir: () => {},
    };
    const loaded = loadStoreFile('/fake/library.json', 'personal', io);
    expect(loaded.file.records.map((r) => r.name)).toEqual(['twice']);
    expect(loaded.diagnostics[0]?.problem).toBe('duplicate');
  });
});

describe('libraryStoreDir', () => {
  it('keys personal by home and project by root — always injected, never ambient', () => {
    expect(libraryStoreDir('/h', '/r', 'personal')).toBe(join('/h', '.coa', 'library'));
    expect(libraryStoreDir('/h', '/r', 'project')).toBe(join('/r', '.coa', 'library'));
  });
});
