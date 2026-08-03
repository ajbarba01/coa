import type { CapabilitySet } from '@coa/shared';
import type { BackendConfig, StopDecision } from '@coa/spi';
import { describe, expect, it } from 'vitest';
import { buildBaseOptions, toSdkPermission, toStopHookOutput } from './sdk-options.js';

function backend(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    systemPrompt: 'SP',
    allowedTools: [],
    disallowedTools: [],
    perAgent: {},
    files: [],
    ...overrides,
  };
}

function sandbox(overrides: Partial<CapabilitySet> = {}): CapabilitySet {
  return {
    allowedTools: [],
    denyRules: [],
    permissionMode: 'default',
    denyRead: [],
    ...overrides,
  };
}

describe('toSdkPermission — the allow result must echo the input back', () => {
  it('carries updatedInput on allow', () => {
    // A bare `{behavior:'allow'}` is type-valid but the real CLI treats it as a
    // permission error for every tool, so nothing executes.
    const input = { file_path: 'a.ts' };
    expect(toSdkPermission({ behavior: 'allow' }, input)).toEqual({
      behavior: 'allow',
      updatedInput: input,
    });
  });

  it('echoes an empty input as an empty object, never omitted', () => {
    expect(toSdkPermission({ behavior: 'allow' }, {})).toEqual({
      behavior: 'allow',
      updatedInput: {},
    });
  });

  it('leaves a deny unchanged — no input echo on the deny branch', () => {
    expect(toSdkPermission({ behavior: 'deny', message: 'capped' }, { a: 1 })).toEqual({
      behavior: 'deny',
      message: 'capped',
    });
  });
});

describe('toStopHookOutput — the close-gate decision → SDK Stop-hook output', () => {
  it('allows the stop when the gate allows (no block)', () => {
    const decision: StopDecision = { allow: true };
    expect(toStopHookOutput(decision)).toEqual({ continue: true });
  });

  it('blocks the close and feeds the gate message back so the agent keeps working', () => {
    // SDK-correct mapping: `decision:'block'` + `reason` blocks the stop and
    // returns the message to the model; `continue:false` would END the turn
    // (the opposite of the gate's intent).
    const decision: StopDecision = { allow: false, message: 'resolve the open invariant first' };
    expect(toStopHookOutput(decision)).toEqual({
      decision: 'block',
      reason: 'resolve the open invariant first',
    });
  });
});

describe('buildBaseOptions — the static query() options from the rendered config + sandbox', () => {
  it('carries the rendered systemPrompt and allow intent through', () => {
    const opts = buildBaseOptions({
      backend: backend({ systemPrompt: 'HEAD', allowedTools: ['get_symbol'] }),
      sandbox: sandbox(),
    });
    expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'HEAD' });
    expect(opts.allowedTools).toEqual(['get_symbol']);
  });

  it('unions the deny intent, the sandbox deny-rules, and denyRead globs into disallowedTools', () => {
    const opts = buildBaseOptions({
      backend: backend({ disallowedTools: ['Edit'] }),
      sandbox: sandbox({ denyRules: ['Bash(coa *)'], denyRead: ['~/.claude/**'] }),
    });
    expect(opts.disallowedTools).toEqual(['Edit', 'Bash(coa *)', 'Read(~/.claude/**)']);
  });

  it('passes a valid sandbox permissionMode through', () => {
    const opts = buildBaseOptions({
      backend: backend(),
      sandbox: sandbox({ permissionMode: 'plan' }),
    });
    expect(opts.permissionMode).toBe('plan');
  });

  it('falls back to the default permission mode when the sandbox value is not a known SDK mode', () => {
    const opts = buildBaseOptions({
      backend: backend(),
      sandbox: sandbox({ permissionMode: 'totally-made-up' }),
    });
    expect(opts.permissionMode).toBe('default');
  });

  it('isolates the session from on-disk config: no setting sources, strict MCP (B1)', () => {
    const opts = buildBaseOptions({ backend: backend(), sandbox: sandbox() });
    // Empty (not undefined) — undefined would let the SDK load ALL sources and
    // leak the target repo's CLAUDE.md/settings as un-authored authority.
    expect(opts.settingSources).toEqual([]);
    expect(opts.strictMcpConfig).toBe(true);
  });
});
