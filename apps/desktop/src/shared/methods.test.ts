import { describe, expect, it } from 'vitest';
import { METHODS, channel } from './methods.js';

describe('IPC method registry', () => {
  it('names channels per verb', () => {
    expect(channel('capState')).toBe('coa:capState');
    expect(channel('saveLayout')).toBe('coa:saveLayout');
  });

  it('validates a cap result and rejects a malformed one', () => {
    expect(METHODS.capState.result.parse({ remaining: null, capHit: false })).toBeTruthy();
    expect(() => METHODS.capState.result.parse({})).toThrow();
  });

  it('accepts an opaque layout for save and read', () => {
    expect(() => METHODS.saveLayout.params?.parse({ any: 'json' })).not.toThrow();
    expect(METHODS.getLayout.result.parse({ any: 'json' })).toBeTruthy();
  });
});
