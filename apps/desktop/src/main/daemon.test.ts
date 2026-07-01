import { describe, expect, it, vi } from 'vitest';
import { resolveDaemon } from './daemon.js';

const okClient = { request: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };

describe('resolveDaemon', () => {
  it('returns a client when the daemon is already up', async () => {
    const connect = vi.fn().mockResolvedValue(okClient);
    const spawn = vi.fn();
    const client = await resolveDaemon({ connect, spawn, path: '\\\\.\\pipe\\coa' });
    expect(client).toBe(okClient);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns the daemon then connects when first connect fails', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(okClient);
    const spawn = vi.fn();
    const client = await resolveDaemon({ connect, spawn, path: '\\\\.\\pipe\\coa' });
    expect(spawn).toHaveBeenCalledOnce();
    expect(client).toBe(okClient);
  });
});
