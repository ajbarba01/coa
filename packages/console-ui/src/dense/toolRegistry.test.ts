// packages/console-ui/src/dense/toolRegistry.test.ts
import { Braces, FileText, Gavel, Pencil, ShieldCheck, Terminal, Wrench } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { describeTool, toolPath } from './toolRegistry.js';

describe('describeTool — Claude / base tools', () => {
  it('describes Read with a path and a line range (file_path or path)', () => {
    const d = describeTool('Read', '{"file_path":"src/auth.ts","offset":1,"limit":40}');
    expect(d.icon).toBe(FileText);
    expect(d.verb).toBe('Read');
    expect(d.summary).toBe('src/auth.ts:1-40');
    // coa's base Read uses `path`, not `file_path` — still resolves.
    expect(describeTool('Read', '{"path":"a.ts"}').summary).toBe('a.ts');
    // offset with no limit shows just the start line (no trailing dash).
    expect(describeTool('Read', '{"file_path":"a.ts","offset":5}').summary).toBe('a.ts:5');
  });

  it('describes Edit with a +N −M diff stat computed from old/new strings', () => {
    const d = describeTool('Edit', '{"file_path":"a.ts","old_string":"x\\ny","new_string":"x\\nY\\nz"}');
    expect(d.icon).toBe(Pencil);
    expect(d.verb).toBe('Edit');
    expect(d.summary).toBe('a.ts +2 −1');
  });

  it('describes Bash with its command', () => {
    const d = describeTool('Bash', '{"command":"npm test"}');
    expect(d.icon).toBe(Terminal);
    expect(d.summary).toBe('npm test');
  });

  it('appends a match count from output for Grep, and omits it on failure', () => {
    expect(describeTool('Grep', '{"pattern":"TODO"}', 'a.ts:1\nb.ts:9\nc.ts:3', true).summary).toBe(
      'TODO · 3 matches',
    );
    expect(describeTool('Grep', '{"pattern":"TODO"}', 'error', false).summary).toBe('TODO');
  });
});

describe('describeTool — coa governed tools', () => {
  it('describes get_symbol from a SymbolRef name', () => {
    const d = describeTool('get_symbol', '{"ref":{"name":"refreshToken"}}');
    expect(d.icon).toBe(Braces);
    expect(d.verb).toBe('get_symbol');
    expect(d.summary).toBe('refreshToken');
  });

  it('describes get_symbol from a path+symbol ref', () => {
    expect(describeTool('get_symbol', '{"ref":{"path":"src/auth.ts","symbol":"mint"}}').summary).toBe('mint');
  });

  it('describes run_checks with its scope (or "all")', () => {
    expect(describeTool('run_checks', '{"scope":"src/auth.ts"}').icon).toBe(ShieldCheck);
    expect(describeTool('run_checks', '{"scope":"src/auth.ts"}').summary).toBe('src/auth.ts');
    expect(describeTool('run_checks', '{}').summary).toBe('all');
  });

  it('describes get_decision with its number', () => {
    const d = describeTool('get_decision', '{"id":85}');
    expect(d.icon).toBe(Gavel);
    expect(d.summary).toBe('#85');
  });

  it('describes why with its target', () => {
    expect(describeTool('why', '{"target":"D85"}').summary).toBe('D85');
  });
});

describe('describeTool — fallback and robustness', () => {
  it('falls back for an unknown tool with a wrench and the tool name as the verb', () => {
    const d = describeTool('DeployRocket', '{"target":"prod"}');
    expect(d.icon).toBe(Wrench);
    expect(d.verb).toBe('DeployRocket');
    expect(d.summary).toBe('');
  });

  it('never throws on malformed input and yields an empty summary', () => {
    expect(() => describeTool('Read', 'not json')).not.toThrow();
    expect(describeTool('Read', 'not json').summary).toBe('');
    expect(describeTool('Edit', '{').summary).toBe('');
  });

  it('yields an empty summary when a known tool input lacks its expected field', () => {
    expect(describeTool('Bash', '{"foo":"bar"}').summary).toBe('');
  });

  it('clips an overly long summary to 72 chars with an ellipsis', () => {
    const d = describeTool('Bash', JSON.stringify({ command: 'x'.repeat(200) }));
    expect(d.summary.length).toBe(73); // 72 chars + the ellipsis glyph
    expect(d.summary.endsWith('…')).toBe(true);
  });
});

describe('toolPath', () => {
  it('extracts the raw path for the file tools (file_path or base-tool path)', () => {
    expect(toolPath('Read', '{"file_path":"src/auth.ts","offset":1,"limit":40}')).toBe('src/auth.ts');
    expect(toolPath('Read', '{"path":"a.ts"}')).toBe('a.ts');
    expect(toolPath('Edit', '{"file_path":"b.ts","old_string":"x","new_string":"y"}')).toBe('b.ts');
    expect(toolPath('Write', '{"file_path":"c.ts","content":"z"}')).toBe('c.ts');
    expect(toolPath('NotebookEdit', '{"notebook_path":"n.ipynb"}')).toBe('n.ipynb');
  });

  it('returns undefined for non-file tools, unknown tools, and malformed input', () => {
    expect(toolPath('Bash', '{"command":"ls"}')).toBeUndefined();
    expect(toolPath('get_symbol', '{"ref":{"name":"x"}}')).toBeUndefined();
    expect(toolPath('DeployRocket', '{"file_path":"x"}')).toBeUndefined();
    expect(() => toolPath('Read', 'not json')).not.toThrow();
    expect(toolPath('Read', 'not json')).toBeUndefined();
  });
});
