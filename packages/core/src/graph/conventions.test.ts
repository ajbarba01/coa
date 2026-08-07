import { describe, expect, it } from 'vitest';
import {
  codegenMarkerExtractor,
  registrySingletonExtractor,
  ExtractorRegistry,
} from './conventions.js';

describe('codegenMarkerExtractor (codegen markers)', () => {
  it('emits a generated-from convention edge for a marked file', () => {
    const result = codegenMarkerExtractor.extract({
      path: 'gen/types.ts',
      lang: 'typescript',
      bytes: '// @generated from src/schema.proto\nexport interface T {}',
    });
    expect(result.edges).toEqual([
      {
        from: 'gen/types.ts',
        to: 'src/schema.proto',
        type: 'generated-from',
        provenance: 'convention',
      },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('records an unresolved site when the marker has no source (honest, not silent)', () => {
    const result = codegenMarkerExtractor.extract({
      path: 'gen/x.ts',
      lang: 'typescript',
      bytes: '// @generated\n',
    });
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual(['gen/x.ts']);
  });

  it('does nothing for an unmarked file', () => {
    const result = codegenMarkerExtractor.extract({
      path: 'a.ts',
      lang: 'typescript',
      bytes: 'const x = 1;',
    });
    expect(result).toEqual({ edges: [], unresolved: [] });
  });
});

describe('registrySingletonExtractor (DI/registry call-sites)', () => {
  it('emits a convention dependency edge for a registerSingleton call-site', () => {
    const result = registrySingletonExtractor.extract({
      path: 'platform/files.ts',
      lang: 'typescript',
      bytes: 'registerSingleton(IFileService, FileService, true);',
    });
    expect(result.edges).toEqual([
      {
        from: 'platform/files.ts',
        to: 'FileService',
        type: 'depends-on',
        provenance: 'convention',
      },
    ]);
  });
});

describe('ExtractorRegistry', () => {
  it('aggregates edges and unresolved sites across registered extractors', () => {
    const registry = new ExtractorRegistry();
    registry.register(codegenMarkerExtractor);
    registry.register(registrySingletonExtractor);
    const result = registry.run({
      path: 'a.ts',
      lang: 'typescript',
      bytes: '// @generated from a.proto\nregisterSingleton(IA, AImpl);',
    });
    expect(result.edges.map((e) => e.to).sort()).toEqual(['AImpl', 'a.proto']);
  });
});
