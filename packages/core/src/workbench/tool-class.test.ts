import { describe, expect, it } from 'vitest';
import { classifyTool } from './tool-class.js';

describe('classifyTool', () => {
  it('classifies a base read tool as read', () => {
    expect(classifyTool('Read')).toBe('read');
    expect(classifyTool('Glob')).toBe('read');
    expect(classifyTool('Grep')).toBe('read');
  });

  it('classifies a base write tool as write', () => {
    expect(classifyTool('Write')).toBe('write');
    expect(classifyTool('Edit')).toBe('write');
  });

  it('classifies Bash as exec', () => {
    expect(classifyTool('Bash')).toBe('exec');
  });

  it('classifies a governed write tool as write, even though its name does not say so (apply_patch)', () => {
    expect(classifyTool('apply_patch')).toBe('write');
    expect(classifyTool('edit_symbol')).toBe('write');
  });

  it('classifies spawn_agent as exec — it starts autonomous work, not a file edit', () => {
    expect(classifyTool('spawn_agent')).toBe('exec');
  });

  it('classifies the governed read-only tools as read', () => {
    expect(classifyTool('get_piece')).toBe('read');
    expect(classifyTool('run_checks')).toBe('read');
    expect(classifyTool('context_status')).toBe('read');
    expect(classifyTool('get_spec')).toBe('read');
  });

  it('classifies egress (web) tools as read — network, not disk or a subprocess', () => {
    expect(classifyTool('WebSearch')).toBe('read');
    expect(classifyTool('WebFetch')).toBe('read');
  });

  it('classifies an unrecognized tool as exec — fail-closed, not fail-open', () => {
    expect(classifyTool('SomeFutureNativeTool')).toBe('exec');
  });
});
