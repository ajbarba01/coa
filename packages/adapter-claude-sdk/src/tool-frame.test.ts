import { describe, expect, it } from 'vitest';
import {
  resolveToolTransport,
  CLAUDE_BUILTIN_FLOOR,
  KNOWN_BUILTINS,
  NOT_MODEL_VISIBLE,
} from './tool-frame.js';

const COA = ['get_symbol', 'edit_symbol', 'why'];
const mcp = (n: string) => `mcp__coa__${n}`;

describe('resolveToolTransport', () => {
  it('never auto-approves: an auto-approved tool never reaches canUseTool', () => {
    // `allowedTools` means AUTO-APPROVE, not availability. Routing coa's allow-intent
    // onto it silently disabled coa's own per-tool gate for exactly the tools coa
    // granted. Availability lives on `tools` + MCP registration instead.
    expect(resolveToolTransport({ allow: [], deny: [], coaToolNames: COA }).autoApprove).toEqual(
      [],
    );
    expect(
      resolveToolTransport({ allow: ['Read', 'get_symbol'], deny: [], coaToolNames: COA })
        .autoApprove,
    ).toEqual([]);
  });

  it('empty allow registers every coa tool and bounds built-ins to the floor', () => {
    // The D85 pass-through still holds for the COA catalogue (all registered, nothing
    // denied), but built-ins are no longer unrestricted: an empty frame now yields the
    // floor rather than the CLI's whole ~37-tool set, because coa governs and records
    // only the floor and no other backend can match the rest.
    const t = resolveToolTransport({ allow: [], deny: [], coaToolNames: COA });
    expect(t.tools).toEqual([...CLAUDE_BUILTIN_FLOOR]);
    expect(t.registerCoaTools).toEqual(COA);
    expect(t.disallowedTools).toEqual([]);
  });

  it('a granted set restricts built-ins via tools and registers only the granted coa tools', () => {
    const t = resolveToolTransport({
      allow: ['Read', 'Bash', 'get_symbol', 'edit_symbol'],
      deny: [],
      coaToolNames: COA,
    });
    expect(t.tools).toEqual(['Read', 'Bash']);
    expect(t.registerCoaTools).toEqual(['get_symbol', 'edit_symbol']);
  });

  it('drops an unresolved ref (a not-yet-built coa-control tool) from the transport', () => {
    const t = resolveToolTransport({
      allow: ['Read', 'create_agent'],
      deny: [],
      coaToolNames: COA,
    });
    expect(t.tools).toEqual(['Read']);
    expect(t.registerCoaTools).toEqual([]);
  });

  it('a role granting zero built-ins yields tools:[] (all built-ins disabled)', () => {
    const t = resolveToolTransport({ allow: ['get_symbol'], deny: [], coaToolNames: COA });
    expect(t.tools).toEqual([]);
    expect(t.registerCoaTools).toEqual(['get_symbol']);
  });

  it('advertises exactly the floor when the frame is an empty pass-through', () => {
    const transport = resolveToolTransport({ allow: [], deny: [], coaToolNames: ['get_symbol'] });
    expect(transport.tools).toEqual([...CLAUDE_BUILTIN_FLOOR]);
  });

  it('drops TodoWrite and both delegation spellings even when explicitly granted', () => {
    const transport = resolveToolTransport({
      allow: ['Read', 'TodoWrite', 'Task', 'Agent'],
      deny: [],
      coaToolNames: [],
    });
    expect(transport.tools).toEqual(['Read']);
  });

  it('keeps the floor as an intersection, never a widening', () => {
    const transport = resolveToolTransport({ allow: ['Read', 'Bash'], deny: [], coaToolNames: [] });
    expect(transport.tools).toEqual(['Read', 'Bash']);
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

describe('KNOWN_BUILTINS', () => {
  it('carries BOTH delegation spellings', () => {
    // The tool was renamed Task → Agent and the pinned CLI still emits both in one run.
    expect(KNOWN_BUILTINS.has('Task')).toBe(true);
    expect(KNOWN_BUILTINS.has('Agent')).toBe(true);
  });

  it('drops a granted Agent by the FLOOR, not by failing to recognise the name', () => {
    // Two different reasons a name can vanish from the transport, and only one is a bug.
    // The original defect was an unknown name silently discarded; the catalogue still
    // knows both spellings, which is what keeps a deny rule and the drift test honest.
    // Absence here is now the deliberate floor: delegation is demoted, to be replaced by
    // a governed spawn tool. If KNOWN_BUILTINS ever forgets the name again, the
    // membership assertions above fail — this one would not.
    expect(KNOWN_BUILTINS.has('Agent')).toBe(true);
    const t = resolveToolTransport({ allow: ['Read', 'Agent'], deny: [], coaToolNames: [] });
    expect(t.tools).toEqual(['Read']);
  });

  it('knows the tools the previous list was missing', () => {
    for (const name of ['TaskStop', 'ExitPlanMode', 'AskUserQuestion', 'EnterWorktree']) {
      expect(KNOWN_BUILTINS.has(name), name).toBe(true);
    }
  });

  it('includes ReadMcpResourceDir, REPL, and Projects (asymmetry: over-include is safe)', () => {
    // Over-including a name is harmless — an unknown entry in tools just matches nothing.
    // Under-including silently drops a grant, repeating the bug this catalogue prevents.
    for (const name of ['ReadMcpResourceDir', 'REPL', 'Projects']) {
      expect(KNOWN_BUILTINS.has(name), name).toBe(true);
    }
  });

  it('keeps the two classifications disjoint', () => {
    for (const name of NOT_MODEL_VISIBLE) expect(KNOWN_BUILTINS.has(name), name).toBe(false);
  });
});
