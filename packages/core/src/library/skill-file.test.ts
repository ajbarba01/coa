import { describe, expect, it } from 'vitest';
import { parseSkillFile } from './skill-file.js';

// Shapes verified against real installed skills (~/.claude/skills): a plain
// scalar description, a folded block scalar, and a front matter dense with
// foreign keys (license/metadata/platforms) that must round-trip verbatim.

describe('parseSkillFile', () => {
  it('parses name, description, and body', () => {
    const skill = parseSkillFile(
      '---\nname: commits\ndescription: how commits are made\n---\n\n# Commits\n\nBody text.\n',
      'commits',
    );
    expect(skill.name).toBe('commits');
    expect(skill.description).toBe('how commits are made');
    expect(skill.body).toBe('\n# Commits\n\nBody text.\n');
    expect(skill.ccKeys).toBeUndefined();
  });

  it('falls back to the directory name when the front matter has no name', () => {
    const skill = parseSkillFile('---\ndescription: d\n---\nbody', 'from-dir');
    expect(skill.name).toBe('from-dir');
  });

  it('defaults a missing description to empty rather than failing', () => {
    const skill = parseSkillFile('---\nname: bare\n---\nbody', 'bare');
    expect(skill.description).toBe('');
  });

  it('keeps every foreign front-matter key verbatim in ccKeys', () => {
    const skill = parseSkillFile(
      [
        '---',
        'name: drawio',
        'description: diagrams',
        'version: 1.14.0',
        'license: MIT',
        'platforms: [macos, linux, windows]',
        'metadata: {"author":"x","nested":{"deep":true}}',
        'disable-model-invocation: true',
        '---',
        'body',
      ].join('\n'),
      'drawio',
    );
    expect(skill.ccKeys).toEqual({
      version: '1.14.0',
      license: 'MIT',
      platforms: ['macos', 'linux', 'windows'],
      metadata: { author: 'x', nested: { deep: true } },
      'disable-model-invocation': true,
    });
  });

  it('handles a folded block-scalar description', () => {
    const skill = parseSkillFile(
      '---\nname: caveman\ndescription: >\n  Ultra-compressed mode.\n  Cuts tokens.\n---\nbody',
      'caveman',
    );
    expect(skill.description).toBe('Ultra-compressed mode. Cuts tokens.\n');
  });

  it('handles CRLF line endings', () => {
    const skill = parseSkillFile('---\r\nname: win\r\ndescription: d\r\n---\r\nbody\r\n', 'win');
    expect(skill.name).toBe('win');
    expect(skill.body).toBe('body\r\n');
  });

  it('parses a file whose bytes open with a UTF-8 BOM', () => {
    const skill = parseSkillFile('﻿---\nname: bom\ndescription: d\n---\nbody', 'from-dir');
    expect(skill.name).toBe('bom');
    expect(skill.description).toBe('d');
    expect(skill.body).toBe('body');
  });

  it('accepts an EMPTY front-matter block (the whole file falls back to the directory name)', () => {
    const skill = parseSkillFile('---\n---\nbody', 'from-dir');
    expect(skill.name).toBe('from-dir');
    expect(skill.description).toBe('');
    expect(skill.body).toBe('body');
    expect(skill.ccKeys).toBeUndefined();
  });

  it('accepts an empty front-matter block with CRLF endings', () => {
    const skill = parseSkillFile('---\r\n---\r\nbody\r\n', 'from-dir');
    expect(skill.name).toBe('from-dir');
    expect(skill.body).toBe('body\r\n');
  });

  it('throws on a file without a front-matter block', () => {
    expect(() => parseSkillFile('# Just markdown\n', 'x')).toThrow(/front-matter/);
  });

  it('throws on unparseable front-matter YAML', () => {
    expect(() => parseSkillFile('---\nname: [unclosed\n---\nbody', 'x')).toThrow();
  });
});
