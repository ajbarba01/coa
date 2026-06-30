import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGenerateFile, validateGenerateConfig } from './generate-config.js';

const write = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'coa-gen-'));
  const path = join(dir, 'generate.yaml');
  writeFileSync(path, body, 'utf8');
  return path;
};

describe('validateGenerateConfig', () => {
  it('maps each keyed relation to a GenerationEntry', () => {
    const [entry, ...rest] = validateGenerateConfig({
      relations: {
        'api-types': {
          source: 'openapi.yaml',
          target: 'src/api.ts',
          lang: 'typescript',
          command: 'openapi-generator generate',
          version: '7.0.0',
        },
      },
    });

    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      name: 'api-types',
      source: 'openapi.yaml',
      target: 'src/api.ts',
      lang: 'typescript',
      command: 'openapi-generator generate',
      version: '7.0.0',
    });
  });

  it('defaults run_on to source-change when omitted', () => {
    const [entry] = validateGenerateConfig({
      relations: { x: { source: 's', target: 't', lang: 'plain', command: 'c', version: '1' } },
    });
    expect(entry?.runOn).toEqual(['source-change']);
  });

  it('translates normalize: [strip-banner, sort-keys] into the GEN-8 canonicalization flags', () => {
    const [entry] = validateGenerateConfig({
      relations: {
        x: {
          source: 's',
          target: 't',
          lang: 'plain',
          command: 'c',
          version: '1',
          normalize: ['strip-banner', 'sort-keys'],
        },
      },
    });
    expect(entry?.stripBanner).toBe(true);
    expect(entry?.sortKeys).toBe(true);
  });

  it('omits the normalize flags when normalize is absent (default empty, GEN-8)', () => {
    const [entry] = validateGenerateConfig({
      relations: { x: { source: 's', target: 't', lang: 'plain', command: 'c', version: '1' } },
    });
    expect(entry).not.toHaveProperty('stripBanner');
    expect(entry).not.toHaveProperty('sortKeys');
  });

  it('carries the bounded ignore_regions anchor pairs', () => {
    const [entry] = validateGenerateConfig({
      relations: {
        x: {
          source: 's',
          target: 't',
          lang: 'plain',
          command: 'c',
          version: '1',
          ignore_regions: [
            [10, 20],
            [30, 40],
          ],
        },
      },
    });
    expect(entry?.ignoreRegions).toEqual([
      [10, 20],
      [30, 40],
    ]);
  });

  it('rejects a malformed relation loudly rather than loading a silent no-op', () => {
    expect(() => validateGenerateConfig({ relations: { x: { source: 's' } } })).toThrow();
  });

  it('rejects an unknown run_on trigger', () => {
    expect(() =>
      validateGenerateConfig({
        relations: {
          x: {
            source: 's',
            target: 't',
            lang: 'plain',
            command: 'c',
            version: '1',
            run_on: ['always'],
          },
        },
      }),
    ).toThrow();
  });

  it('treats an empty document as a valid empty registry', () => {
    expect(validateGenerateConfig({})).toEqual([]);
  });
});

describe('loadGenerateFile', () => {
  it('parses a committed generate.yaml file', () => {
    const path = write(
      [
        'relations:',
        '  api-types:',
        '    source: openapi.yaml',
        '    target: src/api.ts',
        '    lang: typescript',
        '    command: openapi-generator generate',
        "    version: '7.0.0'",
        '    run_on: [source-change, demand]',
        '    normalize: [strip-banner]',
      ].join('\n'),
    );

    const [entry] = loadGenerateFile(path);
    expect(entry?.name).toBe('api-types');
    expect(entry?.runOn).toEqual(['source-change', 'demand']);
    expect(entry?.stripBanner).toBe(true);
  });

  it('treats an absent file as an empty registry', () => {
    expect(loadGenerateFile(join(tmpdir(), 'coa-does-not-exist', 'generate.yaml'))).toEqual([]);
  });
});
