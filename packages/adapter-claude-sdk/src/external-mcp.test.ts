import { describe, expect, it } from 'vitest';
import { toSdkExternalServer, toSdkExternalServers } from './external-mcp.js';

describe('toSdkExternalServer', () => {
  it('maps a stdio entry, omitting absent optionals', () => {
    expect(toSdkExternalServer({ transport: 'stdio', command: 'gh-mcp' })).toEqual({
      type: 'stdio',
      command: 'gh-mcp',
    });
    expect(
      toSdkExternalServer({
        transport: 'stdio',
        command: 'gh-mcp',
        args: ['--stdio'],
        env: { TOKEN: 't' },
      }),
    ).toEqual({ type: 'stdio', command: 'gh-mcp', args: ['--stdio'], env: { TOKEN: 't' } });
  });

  it('maps sse and http entries onto their url shapes', () => {
    expect(toSdkExternalServer({ transport: 'sse', url: 'https://s.example' })).toEqual({
      type: 'sse',
      url: 'https://s.example',
    });
    expect(
      toSdkExternalServer({ transport: 'http', url: 'https://h.example', headers: { K: 'v' } }),
    ).toEqual({ type: 'http', url: 'https://h.example', headers: { K: 'v' } });
  });

  it('does not forward unmodeled extra keys (round-tripped in the store, not the backend)', () => {
    const mapped = toSdkExternalServer({
      transport: 'stdio',
      command: 'x',
      extra: { mystery: true },
    });
    expect('extra' in mapped).toBe(false);
    expect('mystery' in mapped).toBe(false);
  });

  it('maps a whole record, preserving names', () => {
    const mapped = toSdkExternalServers({
      a: { transport: 'stdio', command: 'a' },
      b: { transport: 'http', url: 'https://b.example' },
    });
    expect(Object.keys(mapped)).toEqual(['a', 'b']);
  });
});
