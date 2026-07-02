import { describe, expect, it } from 'vitest';
import { resolveToolTransport } from './tool-frame.js';

const COA = ['get_symbol', 'edit_symbol', 'why'];
const mcp = (n: string) => `mcp__coa__${n}`;

describe('resolveToolTransport', () => {
  it('empty allow is the D85 pass-through: no tools restriction, every coa tool registered + auto-approved', () => {
    const t = resolveToolTransport({ allow: [], deny: [], coaToolNames: COA });
    expect(t.tools).toBeUndefined();
    expect(t.registerCoaTools).toEqual(COA);
    expect(t.allowedTools).toEqual([mcp('get_symbol'), mcp('edit_symbol'), mcp('why')]);
    expect(t.disallowedTools).toEqual([]);
  });

  it('a granted set restricts built-ins via tools and registers only the granted coa tools', () => {
    const t = resolveToolTransport({
      allow: ['Read', 'Bash', 'get_symbol', 'edit_symbol'],
      deny: [],
      coaToolNames: COA,
    });
    expect(t.tools).toEqual(['Read', 'Bash']); // built-in availability restricted
    expect(t.registerCoaTools).toEqual(['get_symbol', 'edit_symbol']); // 'why' not granted → not registered
    expect(t.allowedTools).toEqual(['Read', 'Bash', mcp('get_symbol'), mcp('edit_symbol')]);
  });

  it('drops an unresolved ref (a not-yet-built coa-control tool) from the transport', () => {
    const t = resolveToolTransport({
      allow: ['Read', 'create_agent'],
      deny: [],
      coaToolNames: COA,
    });
    expect(t.tools).toEqual(['Read']); // create_agent is neither a coa tool nor a known built-in → dropped
    expect(t.allowedTools).toEqual(['Read']);
    expect(t.registerCoaTools).toEqual([]);
  });

  it('a role granting zero built-ins yields tools:[] (all built-ins disabled)', () => {
    const t = resolveToolTransport({ allow: ['get_symbol'], deny: [], coaToolNames: COA });
    expect(t.tools).toEqual([]);
    expect(t.registerCoaTools).toEqual(['get_symbol']);
    expect(t.allowedTools).toEqual([mcp('get_symbol')]);
  });

  it('routes deny: coa tools → mcp names, built-ins/rules → bare', () => {
    const t = resolveToolTransport({
      allow: [],
      deny: ['Edit', 'edit_symbol', 'Bash(rm *)'],
      coaToolNames: COA,
    });
    expect(t.disallowedTools).toEqual(['Edit', 'Bash(rm *)', mcp('edit_symbol')]);
  });
});
