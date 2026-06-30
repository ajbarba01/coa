import { describe, expect, it } from 'vitest';
import { TOOL_CATALOGUE, findTools, kernelTools, loadTool } from './catalogue.js';

describe('TOOL_CATALOGUE', () => {
  it('has a unique name per entry', () => {
    const names = TOOL_CATALOGUE.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('kernelTools', () => {
  it('returns the always-loaded common edit/retrieve verbs', () => {
    const names = kernelTools().map((t) => t.name);
    expect(names).toContain('edit_symbol');
    expect(names).toContain('get_symbol');
  });

  it('excludes the on-demand verbs from the always-loaded set', () => {
    const names = kernelTools().map((t) => t.name);
    expect(names).not.toContain('get_decision');
    expect(names).not.toContain('why');
  });
});

describe('findTools', () => {
  it('discovers an on-demand tool by a query over name and description', () => {
    const names = findTools('decision').map((t) => t.name);
    expect(names).toContain('get_decision');
  });

  it('does not surface always-loaded kernel tools (they are already present)', () => {
    const names = findTools('symbol').map((t) => t.name);
    expect(names).not.toContain('get_symbol');
  });
});

describe('loadTool', () => {
  it('pulls an on-demand tool entry by name', () => {
    expect(loadTool('why')?.partition).toBe('on-demand');
  });

  it('returns undefined for an unknown tool', () => {
    expect(loadTool('teleport')).toBeUndefined();
  });
});
