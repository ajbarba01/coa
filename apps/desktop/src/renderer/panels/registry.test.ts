import { describe, expect, it } from 'vitest';
import { parseDescriptor } from '@coa/console-layout';
import { DEFAULT_DESCRIPTOR, buildPanelRegistry } from './registry.js';

describe('panel registry', () => {
  it('registers the three skeleton panels', () => {
    const reg = buildPanelRegistry();
    for (const id of ['nav', 'conversation', 'cost']) expect(reg.has(id)).toBe(true);
  });

  it('the default descriptor survives parseDescriptor unchanged (all panels known)', () => {
    const reg = buildPanelRegistry();
    expect(parseDescriptor(DEFAULT_DESCRIPTOR, reg, DEFAULT_DESCRIPTOR)).toEqual(
      DEFAULT_DESCRIPTOR,
    );
  });
});
