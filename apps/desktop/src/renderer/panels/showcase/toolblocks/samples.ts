// apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts

/** A single tool call, shaped like the live merged `tool` transcript frame so the
 *  specimens are portable to Phase 3. No `output`/`ok` ⇒ still running; `ok:false` ⇒
 *  failed. Bytes in `input`/`output` are verbatim (D128). */
export interface ToolCall {
  id: string;
  tool: string;
  input: string;
  output?: string | undefined;
  ok?: boolean | undefined;
}

export const TOOL_CALLS: ToolCall[] = [
  {
    id: 'read',
    tool: 'Read',
    input: '{\n  "file_path": "src/auth.ts",\n  "offset": 1,\n  "limit": 40\n}',
    output:
      'export function refreshToken(session: Session): Promise<Token> {\n  const next = mint(session.userId);\n  return next.token;\n}',
    ok: true,
  },
  {
    id: 'edit',
    tool: 'Edit',
    input: JSON.stringify(
      {
        file_path: 'src/auth.ts',
        old_string: 'const next = mint(session.userId);\n  return next.token;',
        new_string:
          'const next = await mint(session.userId, { scope: session.scope });\n  if (!next.ok) throw new AuthError("mint failed");\n  return next.token;',
      },
      null,
      2,
    ),
    output: 'Applied 1 edit to src/auth.ts',
    ok: true,
  },
  {
    id: 'write',
    tool: 'Write',
    input: JSON.stringify(
      { file_path: 'src/auth-error.ts', content: 'export class AuthError extends Error {}\n' },
      null,
      2,
    ),
    output: 'Wrote 1 file (39 bytes)',
    ok: true,
  },
  {
    id: 'grep',
    tool: 'Grep',
    input: '{\n  "pattern": "refreshToken",\n  "glob": "*.ts"\n}',
    output: 'src/auth.ts:12\nsrc/auth.ts:31\nsrc/session.ts:88',
    ok: true,
  },
  {
    id: 'glob',
    tool: 'Glob',
    input: '{\n  "pattern": "src/**/*.test.ts"\n}',
    output: 'src/auth.test.ts\nsrc/session.test.ts',
    ok: true,
  },
  {
    id: 'get_symbol',
    tool: 'get_symbol',
    input: '{\n  "ref": { "name": "refreshToken" }\n}',
    output:
      'src/auth.ts · refreshToken(session: Session): Promise<Token>\n  mints a fresh token; the old one is single-use',
    ok: true,
  },
  {
    id: 'edit_symbol',
    tool: 'edit_symbol',
    input: JSON.stringify(
      { ref: { path: 'src/auth.ts', symbol: 'refreshToken' }, diff: { hunks: 1 } },
      null,
      2,
    ),
    output: 'applied · seq 412',
    ok: true,
  },
  {
    id: 'run_checks',
    tool: 'run_checks',
    input: '{\n  "scope": "src/auth.ts"\n}',
    output: 'typecheck ✓  lint ✓  tests ✓  — 0 flags',
    ok: true,
  },
  {
    id: 'why',
    tool: 'why',
    input: '{\n  "target": "D85"\n}',
    output:
      'D85 (strict-superset): every feature adds value or degrades to a literal pass-through; coa is never worse than the raw loop.',
    ok: true,
  },
  {
    id: 'bash-run',
    tool: 'Bash',
    input: '{\n  "command": "npm test"\n}',
    // No output/ok yet — a running call.
  },
  {
    id: 'bash-fail',
    tool: 'Bash',
    input: '{\n  "command": "npm run typecheck"\n}',
    output: 'src/auth.ts(31,5): error TS2554: Expected 1 arguments, but got 2.\n\nExit code: 2',
    ok: false,
  },
  {
    id: 'unknown',
    tool: 'DeployRocket',
    input: '{\n  "target": "prod",\n  "confirm": true\n}',
    output: 'launched 🚀',
    ok: true,
  },
  {
    id: 'read-long',
    tool: 'Read',
    input: '{\n  "file_path": "src/session/session.ts",\n  "offset": 1,\n  "limit": 30\n}',
    output: Array.from({ length: 30 }, (_, i) => `  line ${i + 1} of session.ts;`).join('\n'),
    ok: true,
  },
];
