import type { CapabilitySet } from '@coa/shared';
import type { BackendConfig, StopDecision, ToolPermissionDecision } from '@coa/spi';
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

describe('toSdkPermission — the canUseTool decision → SDK PermissionResult', () => {
  it('maps an allow decision to a behavior:allow result', () => {
    const decision: ToolPermissionDecision = { behavior: 'allow' };
    expect(toSdkPermission(decision)).toEqual({ behavior: 'allow' });
  });

  it('maps a deny decision to a behavior:deny result carrying the message verbatim', () => {
    const decision: ToolPermissionDecision = { behavior: 'deny', message: 'cap hit' };
    expect(toSdkPermission(decision)).toEqual({ behavior: 'deny', message: 'cap hit' });
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
    expect(opts.systemPrompt).toBe('HEAD');
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
