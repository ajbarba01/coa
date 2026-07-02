import { describe, expect, it } from 'vitest';
import { parseDescriptor } from '@coa/console-layout';
import { DEFAULT_DESCRIPTOR, buildPanelRegistry } from './registry.js';

describe('panel registry', () => {
  it('registers the nav rail, the main surfaces, and the dock panes', () => {
    const reg = buildPanelRegistry();
    for (const id of ['nav', 'cost', 'conversation', 'account', 'agents']) {
      expect(reg.has(id)).toBe(true);
    }
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
