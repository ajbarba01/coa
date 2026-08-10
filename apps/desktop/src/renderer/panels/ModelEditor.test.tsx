// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelEntry } from '@coa/console-viewmodel';

// The editor's store talks to the daemon through these console.ts callers — mocked so every
// write resolves a crafted view instead of a real IPC round trip. Daemon-owned semantics
// (seeding, materialise-then-mutate, remove-vs-hide) live in the core suites, not here: this
// file asserts the surface renders the store and routes each act to the right action.
vi.mock('./rpc.js', () => ({
  rpcModelCatalog: vi.fn(),
  rpcAddModels: vi.fn(),
  rpcAddCustomModel: vi.fn(),
  rpcEditModel: vi.fn(),
  rpcRemoveModel: vi.fn(),
  rpcSetModelHidden: vi.fn(),
}));
vi.mock('../console.js', () => ({
  notifyModelsChanged: vi.fn().mockResolvedValue(undefined),
  onModelsChanged: vi.fn(),
}));

import { rpcAddModels, rpcModelCatalog, rpcRemoveModel, rpcSetModelHidden } from './rpc.js';
import { useModels } from './modelsStore.js';
import { ModelsSection } from './ModelEditor.js';
import { PROVIDERS } from './providers.js';
import { useShell } from '../shell/store.js';

const claude = PROVIDERS.find((p) => p.id === 'claude')!;

const entry = (id: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({
  id,
  origin: 'default',
  ...extra,
});

/** A two-model list against a three-model catalog, so add-from-defaults has one to offer. */
const SEED = {
  lists: {
    claude: [
      entry('claude-fable-5', { label: 'fable 5' }),
      entry('my-model', { label: 'mine', origin: 'custom' as const }),
    ],
  },
  catalog: {
    claude: [
      entry('claude-fable-5', { label: 'fable 5' }),
      entry('claude-opus-4-8', { label: 'opus 4.8' }),
      entry('claude-sonnet-5', { label: 'sonnet 5' }),
    ],
  },
};

const SHELL_SEED = useShell.getState();
beforeEach(() => {
  vi.clearAllMocks();
  useModels.setState({ lists: {}, catalog: {} });
  useShell.setState(SHELL_SEED, true);
  vi.mocked(rpcModelCatalog).mockResolvedValue(SEED);
});

describe('ModelsSection', () => {
  it('renders the provider list from the store, custom entries badged', () => {
    useModels.setState(SEED);
    render(<ModelsSection provider={claude} />);
    expect(screen.getByText('fable 5')).toBeTruthy();
    expect(screen.getByText('mine')).toBeTruthy();
    expect(screen.getByText(/^custom$/i)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // the count beside the caps label
  });

  it('a backend the daemon catalog does not serve gets NO editor — never a write black hole', () => {
    useModels.setState(SEED); // catalog has claude only
    const codex = PROVIDERS.find((p) => p.id === 'codex')!;
    render(<ModelsSection provider={codex} />);
    expect(screen.queryByText(/^models$/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^\+ add$/i })).toBeNull();
  });

  it('an empty list renders the backend-default fallback, never a broken section', () => {
    useModels.setState({ ...SEED, lists: { claude: [] } });
    render(<ModelsSection provider={claude} />);
    expect(screen.getByText(/backend default/)).toBeTruthy();
  });

  it('add-from-defaults opens as a dialog offering catalog − list, commit carries the count', async () => {
    useModels.setState(SEED);
    vi.mocked(rpcAddModels).mockResolvedValue(SEED);
    render(<ModelsSection provider={claude} />);

    fireEvent.click(screen.getByRole('button', { name: /^\+ add$/i }));
    fireEvent.click(await screen.findByText(/^add from defaults…$/i));

    const dialog = await screen.findByRole('dialog', { name: /^add from defaults$/i });
    // Offers only what the list lacks.
    expect(within(dialog).getByText('opus 4.8')).toBeTruthy();
    expect(within(dialog).getByText('sonnet 5')).toBeTruthy();
    expect(within(dialog).queryByText('fable 5')).toBeNull();

    fireEvent.click(within(dialog).getByText('opus 4.8'));
    const commit = within(dialog).getByRole('button', { name: /add 1/i });
    fireEvent.click(commit);
    expect(rpcAddModels).toHaveBeenCalledWith({ providerId: 'claude', ids: ['claude-opus-4-8'] });
  });

  it('right-click on a row opens the same actions menu, under the cursor', async () => {
    useModels.setState(SEED);
    render(<ModelsSection provider={claude} />);
    fireEvent.contextMenu(screen.getByText('fable 5'));
    expect(await screen.findByText(/^edit…$/i)).toBeTruthy();
    expect(screen.getByText(/^hide from pickers$/i)).toBeTruthy();
  });

  it('hide flips through the daemon verb; the toggle mirrors the row state', async () => {
    useModels.setState(SEED);
    vi.mocked(rpcSetModelHidden).mockResolvedValue(SEED);
    render(<ModelsSection provider={claude} />);
    fireEvent.click(screen.getByRole('switch', { name: 'fable 5 in the pickers' }));
    expect(rpcSetModelHidden).toHaveBeenCalledWith({
      providerId: 'claude',
      id: 'claude-fable-5',
      hidden: true,
    });
  });

  it('removing a DEFAULT acts straight from the menu; removing a CUSTOM asks first', async () => {
    useModels.setState(SEED);
    vi.mocked(rpcRemoveModel).mockResolvedValue(SEED);
    render(<ModelsSection provider={claude} />);

    // Default: unconfirmed (two clicks from being re-added).
    fireEvent.contextMenu(screen.getByText('fable 5'));
    fireEvent.click(await screen.findByText(/^remove$/i));
    expect(rpcRemoveModel).toHaveBeenCalledWith({ providerId: 'claude', id: 'claude-fable-5' });

    // Custom: the destructive path — a confirm dialog stands in the way.
    vi.mocked(rpcRemoveModel).mockClear();
    fireEvent.contextMenu(screen.getByText('mine'));
    fireEvent.click(await screen.findByText(/^remove…$/i));
    expect(rpcRemoveModel).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: /^remove model$/i });
    fireEvent.click(within(confirm).getByRole('button', { name: /remove model/i }));
    expect(rpcRemoveModel).toHaveBeenCalledWith({ providerId: 'claude', id: 'my-model' });
  });
});
