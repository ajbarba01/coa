import { beforeEach, describe, expect, it, vi } from 'vitest';

const view = {
  lists: { claude: [{ id: 'a', origin: 'default' as const }] },
  catalog: { claude: [{ id: 'a', origin: 'default' as const }, { id: 'b', origin: 'default' as const }] },
};

// vi.mock is hoisted above this file's imports, so the factory below must not reference any
// outer `const` (a reference to it before initialization throws) — the inline-`vi.fn()` shape
// matches AuthPanel.test.tsx's idiom for the same reason. The `rpc` alias built below (after
// the mocked module is imported) is what the assertions below read.
vi.mock('../console.js', () => ({
  rpcModelCatalog: vi.fn(),
  rpcAddModels: vi.fn(),
  rpcAddCustomModel: vi.fn(),
  rpcEditModel: vi.fn(),
  rpcRemoveModel: vi.fn(),
  rpcSetModelHidden: vi.fn(),
  notifyModelsChanged: vi.fn(),
  onModelsChanged: vi.fn(),
}));

import {
  notifyModelsChanged,
  onModelsChanged,
  rpcAddCustomModel,
  rpcAddModels,
  rpcEditModel,
  rpcModelCatalog,
  rpcRemoveModel,
  rpcSetModelHidden,
} from '../console.js';

const rpc = {
  rpcModelCatalog: vi.mocked(rpcModelCatalog),
  rpcAddModels: vi.mocked(rpcAddModels),
  rpcAddCustomModel: vi.mocked(rpcAddCustomModel),
  rpcEditModel: vi.mocked(rpcEditModel),
  rpcRemoveModel: vi.mocked(rpcRemoveModel),
  rpcSetModelHidden: vi.mocked(rpcSetModelHidden),
  notifyModelsChanged: vi.mocked(notifyModelsChanged),
  onModelsChanged: vi.mocked(onModelsChanged),
};
rpc.rpcModelCatalog.mockResolvedValue(view);
rpc.rpcAddModels.mockResolvedValue(view);
rpc.rpcAddCustomModel.mockResolvedValue(view);
rpc.rpcEditModel.mockResolvedValue(view);
rpc.rpcRemoveModel.mockResolvedValue(view);
rpc.rpcSetModelHidden.mockResolvedValue(view);
rpc.notifyModelsChanged.mockResolvedValue(undefined);

import { offerable, useModels } from './modelsStore.js';

describe('useModels', () => {
  beforeEach(() => {
    useModels.setState({ lists: {}, catalog: {} });
    vi.clearAllMocks();
  });

  it('hydrate reprojects the daemon view', async () => {
    await useModels.getState().hydrate();
    expect(useModels.getState().lists['claude']?.[0]?.id).toBe('a');
  });

  it('a write reprojects the returned view and refreshes the picker feed', async () => {
    await useModels.getState().setHidden('claude', 'a', true);
    expect(rpc.rpcSetModelHidden).toHaveBeenCalledWith({ providerId: 'claude', id: 'a', hidden: true });
    expect(useModels.getState().catalog['claude']?.length).toBe(2);
    expect(rpc.notifyModelsChanged).toHaveBeenCalled();
  });

  it('offerable = catalog minus the list', () => {
    expect(offerable(view.catalog['claude']!, view.lists['claude']!).map((m) => m.id)).toEqual(['b']);
  });
});
