import { describe, expect, it } from 'vitest';
import { parseDescriptor } from '@coa/console-layout';
import { DEFAULT_DESCRIPTOR, buildPanelRegistry } from './registry.js';

describe('panel registry', () => {
  it('registers the nav rail, cost, and the dock placeholders', () => {
    const reg = buildPanelRegistry();
    for (const id of ['nav', 'cost', 'conversation', 'agent']) expect(reg.has(id)).toBe(true);
  });

  it('registers the live chat panel at the conversation id', () => {
    const reg = buildPanelRegistry();
    expect(reg.resolve('conversation')?.displayName).toBe('Chat');
  });

  it('the default descriptor survives parseDescriptor unchanged (all panels known)', () => {
    const reg = buildPanelRegistry();
    expect(parseDescriptor(DEFAULT_DESCRIPTOR, reg, DEFAULT_DESCRIPTOR)).toEqual(
      DEFAULT_DESCRIPTOR,
    );
  });
});
