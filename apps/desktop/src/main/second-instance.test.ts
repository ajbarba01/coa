import { describe, expect, it } from 'vitest';
import { secondInstanceTarget } from './second-instance.js';

describe('secondInstanceTarget', () => {
  it('names the project when the last argv entry is a real directory', () => {
    const isDirectory = (p: string): boolean => p === 'C:\\repos\\alpha';
    expect(secondInstanceTarget(['coa.exe', 'C:\\repos\\alpha'], isDirectory)).toBe(
      'C:\\repos\\alpha',
    );
  });

  it('names nothing when the last argv entry is not a real directory (a plain relaunch)', () => {
    const isDirectory = (): boolean => false;
    expect(secondInstanceTarget(['coa.exe'], isDirectory)).toBeUndefined();
  });

  it('never treats a flag as a project path, even if a directory happens to share its name', () => {
    const isDirectory = (): boolean => true; // pathological: everything "exists"
    expect(secondInstanceTarget(['coa.exe', '--flag'], isDirectory)).toBeUndefined();
  });

  it('an empty argv names nothing', () => {
    expect(secondInstanceTarget([], () => true)).toBeUndefined();
  });
});
