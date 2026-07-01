import { describe, expect, it } from 'vitest';
import { IPC_GET_CAP, CapResultSchema } from './ipc.js';

describe('ipc contract', () => {
  it('names the cap channel', () => {
    expect(IPC_GET_CAP).toBe('coa:getCap');
  });
  it('validates a cap result payload', () => {
    expect(CapResultSchema.parse({ remaining: null, capHit: false })).toBeTruthy();
    expect(() => CapResultSchema.parse({})).toThrow();
  });
});
