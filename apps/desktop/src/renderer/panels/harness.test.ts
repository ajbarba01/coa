import { describe, expect, it } from 'vitest';
import { COA_MARK, harnessBlurb, harnessLabel, harnessOf } from './harness.js';

describe('harnessOf', () => {
  it('puts Claude models on the vendor harness coa layers onto', () => {
    expect(harnessOf('claude')).toBe('claude-code');
  });

  it('puts a pure-API backend on coa’s own scaffold', () => {
    expect(harnessOf('deepseek')).toBe('coa');
    expect(harnessOf('longcat')).toBe('coa');
  });

  it('follows the runtime default when no provider is set (the daemon itself defaults to claude)', () => {
    expect(harnessOf(undefined)).toBe('claude-code');
  });

  it('labels each harness the way the dropdown groups them', () => {
    expect(harnessLabel('claude-code')).toBe('Claude Code');
    expect(harnessLabel('coa')).toBe('coa scaffold');
  });
});

describe('harnessBlurb', () => {
  it('names the vendor preset coa layers onto, on the Claude harness', () => {
    expect(harnessBlurb('claude-code')).toContain('Claude Code');
  });

  it('states that coa supplies the whole scaffold on the pure-API harness', () => {
    expect(harnessBlurb('coa')).toContain('scaffold');
  });

  it('gives each harness its own sentence', () => {
    expect(harnessBlurb('claude-code')).not.toBe(harnessBlurb('coa'));
  });

  it('starts each sentence with a capital — the deliberate lowercase of the "coa scaffold" LABEL does not extend to prose', () => {
    expect(harnessBlurb('claude-code')).toMatch(/^[A-Z]/);
    expect(harnessBlurb('coa')).toMatch(/^[A-Z]/);
  });
});

describe('COA_MARK', () => {
  it('carries a monogram tile with no bundled vendor art', () => {
    expect(COA_MARK.monogram).toBe('c');
    expect(COA_MARK.paths).toBeUndefined();
  });

  it('wears a token, not a raw hex — this is coa’s own mark, not a vendor’s (ADR-0015 is about the outside world)', () => {
    expect(COA_MARK.color).toMatch(/^var\(--color-/);
  });
});
