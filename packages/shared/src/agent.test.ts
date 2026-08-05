import { describe, expect, it } from 'vitest';
import { agentFileSchema, agentSummarySchema } from './agent.js';

describe('agentFileSchema', () => {
  it('requires a name and a description', () => {
    expect(agentFileSchema.safeParse({ name: 'Worker' }).success).toBe(false);
    expect(agentFileSchema.safeParse({ description: 'does work' }).success).toBe(false);
  });

  it('rejects an empty description — the field delegation depends on', () => {
    expect(agentFileSchema.safeParse({ name: 'Worker', description: '' }).success).toBe(false);
  });

  it('defaults icon and color, and degrades unknown vocabulary rather than failing', () => {
    const parsed = agentFileSchema.parse({ name: 'Worker', description: 'does work' });
    expect(parsed.icon).toBe('bot');
    expect(parsed.color).toBe('slate');
    const odd = agentFileSchema.parse({
      name: 'Worker',
      description: 'does work',
      icon: 'not-a-real-icon',
      color: 'chartreuse',
    });
    expect(odd.icon).toBe('bot');
    expect(odd.color).toBe('slate');
  });

  it('does not carry ref or scope — the filename and directory supply those', () => {
    const parsed = agentFileSchema.parse({ name: 'Worker', description: 'does work' });
    expect('ref' in parsed).toBe(false);
    expect('scope' in parsed).toBe(false);
  });
});

describe('agentSummarySchema', () => {
  it('is the file shape plus a resolved ref and scope', () => {
    const parsed = agentSummarySchema.parse({
      ref: 'worker',
      scope: 'project',
      name: 'Worker',
      description: 'does work',
    });
    expect(parsed.ref).toBe('worker');
    expect(parsed.scope).toBe('project');
  });

  it('admits the builtin scope', () => {
    expect(
      agentSummarySchema.safeParse({
        ref: 'general-purpose',
        scope: 'builtin',
        name: 'General purpose',
        description: 'does work',
      }).success,
    ).toBe(true);
  });
});
