import { describe, expect, it } from 'vitest';
import { renderToolResult, toolResultOk } from './render-result.js';

/**
 * The per-tool display-text renderer (used by the pure-API loop for BOTH the emitted
 * `tool_result` frame's pointer and the model's tool-message content). Each case pins the
 * showcase-target format (apps/desktop/.../showcase/toolblocks/samples.ts). Unknown tools
 * and unrecognized result shapes fall back to a verbatim JSON dump — never throw, never lose data.
 */
describe('renderToolResult', () => {
  describe('base tools', () => {
    it('Read → the file content verbatim (byte-faithful)', () => {
      const content = '1\texport function refreshToken() {\n2\t  return mint();\n3\t}';
      expect(renderToolResult('Read', { found: true, content })).toBe(content);
    });

    it('Read not-found → a short reason', () => {
      expect(renderToolResult('Read', { found: false, reason: 'not-found' })).toBe(
        'not found: not-found',
      );
    });

    it('Read not-found without a reason → a generic message', () => {
      expect(renderToolResult('Read', { found: false })).toBe('not found');
    });

    it('Glob → matches, one per line', () => {
      expect(
        renderToolResult('Glob', { matches: ['src/auth.test.ts', 'src/session.test.ts'] }),
      ).toBe('src/auth.test.ts\nsrc/session.test.ts');
    });

    it('Glob with no matches → an empty string (no body; the header shows the 0-count)', () => {
      expect(renderToolResult('Glob', { matches: [] })).toBe('');
    });

    it('Grep → file:line:text per hit (the defect case)', () => {
      const result = {
        hits: [
          { file: 'src/auth.ts', line: 31, text: '  const next = mint(id);' },
          { file: 'src/session.ts', line: 88, text: 'export const refreshToken = () => {};' },
        ],
      };
      expect(renderToolResult('Grep', result)).toBe(
        'src/auth.ts:31:  const next = mint(id);\nsrc/session.ts:88:export const refreshToken = () => {};',
      );
    });

    it('Grep files-mode hits (no line/text) → just the file', () => {
      expect(
        renderToolResult('Grep', { hits: [{ file: 'src/auth.ts' }, { file: 'src/session.ts' }] }),
      ).toBe('src/auth.ts\nsrc/session.ts');
    });

    it('Grep line-only hit → file:line', () => {
      expect(renderToolResult('Grep', { hits: [{ file: 'src/auth.ts', line: 12 }] })).toBe(
        'src/auth.ts:12',
      );
    });

    it('Grep with no hits → an empty string (no body; the header shows the 0-count)', () => {
      expect(renderToolResult('Grep', { hits: [] })).toBe('');
    });

    it('Write applied → Wrote <path>', () => {
      expect(
        renderToolResult('Write', {
          applied: true,
          path: 'src/auth-error.ts',
          seq: 5,
          created: true,
        }),
      ).toBe('Wrote src/auth-error.ts');
    });

    it('Write over an existing file → Wrote <path>', () => {
      expect(
        renderToolResult('Write', { applied: true, path: 'src/auth.ts', seq: 6, created: false }),
      ).toBe('Wrote src/auth.ts');
    });

    it('Write unapplied → the error message', () => {
      expect(
        renderToolResult('Write', {
          applied: false,
          error: { code: 'confined', message: 'path escapes worktree' },
        }),
      ).toBe('path escapes worktree');
    });

    it('Edit applied → Applied 1 edit to <path>', () => {
      expect(
        renderToolResult('Edit', { applied: true, path: 'src/auth.ts', seq: 7, created: false }),
      ).toBe('Applied 1 edit to src/auth.ts');
    });

    it('Edit unapplied → the error message', () => {
      expect(
        renderToolResult('Edit', {
          applied: false,
          error: { code: 'edit-no-match', message: 'old_string not found: foo' },
        }),
      ).toBe('old_string not found: foo');
    });

    it('Bash exit 0 → stdout', () => {
      expect(
        renderToolResult('Bash', { stdout: 'all tests passed\n', stderr: '', exitCode: 0 }),
      ).toBe('all tests passed\n');
    });

    it('Bash non-zero → stdout + stderr + an exit-code line', () => {
      expect(
        renderToolResult('Bash', {
          stdout: 'src/auth.ts(31,5): error TS2554',
          stderr: 'compilation failed',
          exitCode: 2,
        }),
      ).toBe('src/auth.ts(31,5): error TS2554\ncompilation failed\nExit code: 2');
    });

    it('Bash exit 0 with only stderr → the stderr', () => {
      expect(renderToolResult('Bash', { stdout: '', stderr: 'a warning', exitCode: 0 })).toBe(
        'a warning',
      );
    });
  });

  describe('governed tools', () => {
    it('get_symbol found → the signature and location', () => {
      const symbol = {
        name: 'refreshToken',
        signature: 'export function refreshToken(session: Session): Promise<Token>',
        definedIn: 'src/auth.ts',
      };
      expect(renderToolResult('get_symbol', { found: true, symbol })).toBe(
        'export function refreshToken(session: Session): Promise<Token>\n— src/auth.ts',
      );
    });

    it('get_symbol found without a signature → name and location', () => {
      expect(
        renderToolResult('get_symbol', {
          found: true,
          symbol: { name: 'refreshToken', definedIn: 'src/auth.ts' },
        }),
      ).toBe('refreshToken\n— src/auth.ts');
    });

    it('get_symbol not found → a short reason', () => {
      expect(renderToolResult('get_symbol', { found: false, reason: 'no-symbol' })).toBe(
        'not found: no-symbol',
      );
    });

    it('get_piece found → the piece body', () => {
      const piece = {
        name: 'token-rotation',
        description: 'how tokens rotate',
        body: '# Token rotation\n\nThe refresh token is single-use.',
        axes: { provenance: 'authored' as const },
      };
      expect(renderToolResult('get_piece', { found: true, piece })).toBe(
        '# Token rotation\n\nThe refresh token is single-use.',
      );
    });

    it('get_piece not found → a short message', () => {
      expect(renderToolResult('get_piece', { found: false })).toBe('not found');
    });

    it('get_spec present → the spec text', () => {
      expect(renderToolResult('get_spec', { ref: 'src/auth.ts', spec: 'must rotate tokens' })).toBe(
        'must rotate tokens',
      );
    });

    it('get_spec absent → a no-spec message', () => {
      expect(renderToolResult('get_spec', { ref: 'src/auth.ts', spec: null })).toBe(
        'no governing spec for src/auth.ts',
      );
    });

    it('edit_symbol applied → applied · seq <seq>', () => {
      expect(
        renderToolResult('edit_symbol', { applied: true, path: 'src/auth.ts', seq: 412 }),
      ).toBe('applied · seq 412');
    });

    it('edit_symbol unapplied → the error message', () => {
      expect(
        renderToolResult('edit_symbol', {
          applied: false,
          error: { code: 'ref-unresolved', message: 'could not resolve the ref' },
        }),
      ).toBe('could not resolve the ref');
    });

    it('apply_patch applied → applied · seq <seq>', () => {
      expect(
        renderToolResult('apply_patch', { applied: true, path: 'src/auth-error.ts', seq: 9 }),
      ).toBe('applied · seq 9');
    });

    it('run_checks → a check summary with the flag count', () => {
      const feed = {
        expanded: [
          {
            ruleId: 'no-any',
            location: 'src/auth.ts:3',
            severity: 'high' as const,
            message: 'avoid any',
            fingerprint: 'fp1',
            type: 1 as const,
            confidence: 'high' as const,
            concernKey: 'types',
          },
        ],
        collapsed: [{ concernKey: 'style', count: 4, severity: 'low' }],
      };
      expect(renderToolResult('run_checks', feed)).toBe('5 flags (1 shown, 4 collapsed)');
    });

    it('run_checks with no flags → a clean summary', () => {
      expect(renderToolResult('run_checks', { expanded: [], collapsed: [] })).toBe('0 flags');
    });

    it('why → the decision entries for the target', () => {
      const result = {
        target: 'D85',
        decisions: [
          { id: 3, target: 'D85', entry: 'strict-superset: never worse than the raw loop' },
        ],
      };
      expect(renderToolResult('why', result)).toBe(
        'strict-superset: never worse than the raw loop',
      );
    });

    it('why with no decisions → a no-rationale message', () => {
      expect(renderToolResult('why', { target: 'D999', decisions: [] })).toBe(
        'no recorded rationale for D999',
      );
    });

    it('get_decision found → the entry', () => {
      expect(
        renderToolResult('get_decision', {
          found: true,
          decision: { id: 4, target: 'src/u.ts#userName', entry: 'renamed for clarity' },
        }),
      ).toBe('#4 src/u.ts#userName: renamed for clarity');
    });

    it('get_decision not found → a short message', () => {
      expect(renderToolResult('get_decision', { found: false })).toBe('not found');
    });

    it('find_references → the reference sites, one per line', () => {
      expect(
        renderToolResult('find_references', {
          symbol: 'refreshToken',
          sites: ['src/auth.ts:12', 'src/session.ts:88'],
        }),
      ).toBe('src/auth.ts:12\nsrc/session.ts:88');
    });

    it('find_references with no sites → a no-references message', () => {
      expect(renderToolResult('find_references', { symbol: 'orphan', sites: [] })).toBe(
        'no references to orphan',
      );
    });

    it('outline → the symbols, one per line', () => {
      expect(
        renderToolResult('outline', {
          path: 'src/auth.ts',
          symbols: [
            {
              name: 'refreshToken',
              definedIn: 'src/auth.ts',
              signature: 'function refreshToken()',
            },
            { name: 'mint', definedIn: 'src/auth.ts' },
          ],
        }),
      ).toBe('function refreshToken()\nmint');
    });

    it('outline with no symbols → a message', () => {
      expect(renderToolResult('outline', { path: 'src/empty.ts', symbols: [] })).toBe(
        'no symbols in src/empty.ts',
      );
    });
  });

  describe('web tools', () => {
    it('WebSearch → each hit as `title — url`, with the snippet on its own line', () => {
      const result = {
        results: [
          { title: 'Rotating tokens', url: 'https://ex.com/a', snippet: 'single-use refresh' },
          { title: 'JWT basics', url: 'https://ex.com/b', snippet: '' },
        ],
      };
      expect(renderToolResult('WebSearch', result)).toBe(
        'Rotating tokens — https://ex.com/a\nsingle-use refresh\nJWT basics — https://ex.com/b',
      );
    });

    it('WebSearch with no results → the reason (not a broken body)', () => {
      expect(renderToolResult('WebSearch', { results: [], reason: 'no-search-provider' })).toBe(
        'no-search-provider',
      );
    });

    it('WebFetch fetched → the page content verbatim', () => {
      expect(
        renderToolResult('WebFetch', {
          fetched: true,
          content: '# Title\n\nbody',
          summarized: false,
        }),
      ).toBe('# Title\n\nbody');
    });

    it('WebFetch failed → the failure reason', () => {
      expect(
        renderToolResult('WebFetch', { fetched: false, reason: 'no-provider-succeeded' }),
      ).toBe('no-provider-succeeded');
    });
  });

  describe('toolResultOk', () => {
    it('Read found/not-found', () => {
      expect(toolResultOk('Read', { found: true, content: 'x' })).toBe(true);
      expect(toolResultOk('Read', { found: false, reason: 'not-found' })).toBe(false);
    });

    it('get_symbol / get_piece / get_decision found gate', () => {
      expect(toolResultOk('get_symbol', { found: false })).toBe(false);
      expect(toolResultOk('get_piece', { found: true, piece: {} })).toBe(true);
      expect(toolResultOk('get_decision', { found: false })).toBe(false);
    });

    it('get_spec: a null spec is a miss, a present spec is ok', () => {
      expect(toolResultOk('get_spec', { ref: 'a', spec: null })).toBe(false);
      expect(toolResultOk('get_spec', { ref: 'a', spec: 'must rotate' })).toBe(true);
    });

    it('mutate/write applied gate', () => {
      expect(toolResultOk('edit_symbol', { applied: true, path: 'a', seq: 1 })).toBe(true);
      expect(
        toolResultOk('apply_patch', { applied: false, error: { code: 'x', message: 'm' } }),
      ).toBe(false);
      expect(toolResultOk('Write', { applied: false, error: { code: 'x', message: 'm' } })).toBe(
        false,
      );
      expect(toolResultOk('Edit', { applied: true, path: 'a', seq: 1, created: false })).toBe(true);
    });

    it('Bash: exit 0 ok, non-zero fails', () => {
      expect(toolResultOk('Bash', { stdout: '', stderr: '', exitCode: 0 })).toBe(true);
      expect(toolResultOk('Bash', { stdout: '', stderr: 'boom', exitCode: 2 })).toBe(false);
    });

    it('WebFetch fetched gate; WebSearch never fails on empty', () => {
      expect(toolResultOk('WebFetch', { fetched: false, reason: 'x' })).toBe(false);
      expect(toolResultOk('WebFetch', { fetched: true, content: '', summarized: false })).toBe(
        true,
      );
      expect(toolResultOk('WebSearch', { results: [], reason: 'none' })).toBe(true);
    });

    it('Grep / Glob: an empty result is NOT a failure', () => {
      expect(toolResultOk('Grep', { hits: [] })).toBe(true);
      expect(toolResultOk('Glob', { matches: [] })).toBe(true);
    });

    it('an unmapped tool or an unrecognized shape ⇒ true (never falsely fails)', () => {
      expect(toolResultOk('DeployRocket', { anything: 1 })).toBe(true);
      expect(toolResultOk('Read', { unexpected: 'shape' })).toBe(true);
      expect(toolResultOk('Bash', null)).toBe(true);
    });
  });

  describe('fallback', () => {
    it('an unknown tool → a verbatim JSON dump', () => {
      const result = { target: 'prod', confirm: true };
      expect(renderToolResult('DeployRocket', result)).toBe(JSON.stringify(result));
    });

    it('a known tool with an unexpected result shape → a verbatim JSON dump (never throws)', () => {
      const weird = { unexpected: 'shape' };
      expect(renderToolResult('Grep', weird)).toBe(JSON.stringify(weird));
    });

    it('a null result → the JSON fallback', () => {
      expect(renderToolResult('DeployRocket', null)).toBe('null');
    });

    it('never throws on a circular / non-serializable result — returns a safe marker', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => renderToolResult('DeployRocket', circular)).not.toThrow();
    });
  });
});
