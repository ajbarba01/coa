import { describe, expect, it } from 'vitest';
import { FlagPipeline } from './pipeline.js';

describe('FlagPipeline.perToolDeny (the M6-declared per-tool advisory→deny)', () => {
  it('returns undefined when no rule is registered for the tool', () => {
    expect(new FlagPipeline().perToolDeny('Edit', {})).toBeUndefined();
  });

  it('denies with the rule message when a registered rule matches', () => {
    const pipe = new FlagPipeline();
    pipe.registerToolDeny({
      tool: 'Edit',
      matches: (input) => (input as { path?: string }).path === 'locked.ts',
      message: 'use edit_symbol — built-in Edit is demoted here',
    });
    expect(pipe.perToolDeny('Edit', { path: 'locked.ts' })).toEqual({
      behavior: 'deny',
      message: 'use edit_symbol — built-in Edit is demoted here',
    });
  });

  it('does not deny when the rule predicate does not match', () => {
    const pipe = new FlagPipeline();
    pipe.registerToolDeny({ tool: 'Edit', matches: () => false, message: 'x' });
    expect(pipe.perToolDeny('Edit', { path: 'free.ts' })).toBeUndefined();
  });

  it('does not deny a different tool', () => {
    const pipe = new FlagPipeline();
    pipe.registerToolDeny({ tool: 'Edit', matches: () => true, message: 'x' });
    expect(pipe.perToolDeny('Read', {})).toBeUndefined();
  });
});
