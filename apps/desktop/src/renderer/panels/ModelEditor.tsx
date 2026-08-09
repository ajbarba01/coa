import {
  BrandMark,
  Button,
  CapsLabel,
  MenuItem,
  ModalShell,
  PopoverCard,
  StatusDot,
  Toggle,
  Tooltip,
  cx,
  useDismissLayer,
} from '@coa/console-kit';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { ModelEntry, ReasoningProfile } from '@coa/console-viewmodel';
import { surfaceWrite } from '../shell/failures.js';
import { useShell } from '../shell/store.js';
import { TextInput } from './fields.js';
import { RISE, SLIP_ENTER } from './motion.js';
import {
  EFFORTS,
  entryLabel,
  offerable,
  profileOf,
  reasoningSummary,
  useModels,
  type Effort,
} from './modelsStore.js';
import type { ProviderDescriptor } from './providers.js';
import { RowMenu } from './RowMenu.js';

/**
 * The per-provider MODEL EDITOR — the surface over the editable model list that feeds both
 * pickers (the chat chip and the agent config). The user's list is the source of truth: here
 * they add from the coa-owned default catalog, create a custom id, edit a model's label +
 * reasoning profile, hide it from the pickers (the everyday declutter), or remove it. Hide
 * and remove stay distinct on purpose (hide = out of my pickers; remove = out of my list),
 * and remove confirms only for a CUSTOM model — a default is two clicks from being re-added,
 * a custom has no catalog to come back from.
 *
 * Data is LIVE from the daemon via `useModels` (hydrate + reproject-on-write); the two
 * dialogs live in the shell's exclusive dialog set (single-dialog rule).
 */

/** Stable empty for the store selectors — a fresh `[]` per snapshot re-renders forever. */
const NO_MODELS: ModelEntry[] = [];

export function ModelsSection({ provider }: { provider: ProviderDescriptor }): React.JSX.Element {
  const models = useModels((s) => s.lists[provider.id] ?? NO_MODELS);
  // Only providers the daemon's catalog view actually carries get an editor: a backend the
  // verb layer doesn't serve (codex, gemini) would persist writes the view could never show
  // again — a silent black hole, worse than no section.
  const served = useModels((s) => s.catalog[provider.id] !== undefined);
  const openDefaults = useShell((s) => s.setAddModelsProvider);
  const [creating, setCreating] = useState(false);

  // Live daemon read on mount (idempotent — the AuthSurface pattern). Advisory: a failed
  // read leaves the last projection standing, never an unhandled rejection.
  useEffect(() => {
    void useModels
      .getState()
      .hydrate()
      .catch(() => {});
  }, []);

  const hiddenCount = models.filter((m) => m.hidden === true).length;

  if (!served) return <></>;

  return (
    <>
      <div className="mt-7 mb-1.5 flex items-baseline border-b border-s3 pb-1.5">
        <CapsLabel className="px-0 pt-0">Models</CapsLabel>
        <span className="ml-2 font-mono text-meta text-s7">{models.length}</span>
        {hiddenCount > 0 && (
          <span className="ml-2 font-mono text-meta text-s7">{hiddenCount} hidden</span>
        )}
        <AddMenu
          onAddDefaults={() => openDefaults(provider.id)}
          onCreateCustom={() => setCreating(true)}
        />
      </div>

      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            key="custom"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SLIP_ENTER}
            className="overflow-hidden"
          >
            <CreateCustomRow provider={provider} onDone={() => setCreating(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {models.length === 0 && !creating && (
        <div className="flex flex-col gap-1 py-6 text-center text-sec text-s7">
          <span>No models. The picker falls back to {provider.label}&apos;s backend default.</span>
          {(provider.id === 'deepseek' || provider.id === 'longcat') && (
            <span className="text-meta text-s6">
              Ids from an adapter config file are not migrated. Re-add them here to see them in the
              pickers.
            </span>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {models.map((m) => (
          <motion.div key={m.id} {...RISE}>
            <ModelRow provider={provider} model={m} />
          </motion.div>
        ))}
      </AnimatePresence>

      <AddFromDefaultsDialog provider={provider} />
      <RemoveCustomConfirm provider={provider} />
    </>
  );
}

/** The "+ add" affordance heading the models section — the two ways a model enters the list. */
function AddMenu({
  onAddDefaults,
  onCreateCustom,
}: {
  onAddDefaults: () => void;
  onCreateCustom: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="w-52"
      trigger={
        <Button variant="text" className="ml-auto">
          + Add
        </Button>
      }
    >
      <div onClick={() => setOpen(false)}>
        <MenuItem onClick={onAddDefaults}>
          <span className="flex flex-col gap-px">
            <span className="text-sec text-s11">Add from Defaults…</span>
            <span className="text-meta text-s7">coa&apos;s curated catalog</span>
          </span>
        </MenuItem>
        <MenuItem onClick={onCreateCustom}>
          <span className="flex flex-col gap-px">
            <span className="text-sec text-s11">Create Custom…</span>
            <span className="text-meta text-s7">Any id the backend accepts</span>
          </span>
        </MenuItem>
      </div>
    </PopoverCard>
  );
}

function ModelRow({
  provider,
  model,
}: {
  provider: ProviderDescriptor;
  model: ModelEntry;
}): React.JSX.Element {
  const setHidden = useModels((s) => s.setHidden);
  const removeModel = useModels((s) => s.removeModel);
  const confirmRemove = useShell((s) => s.setConfirmRemoveModel);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Set only by right-click: the menu opens under the CURSOR, not under the ⋯ it happens
  // to share. Cleared on close so the ⋯ click anchors normally again.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number }>();

  if (editing) {
    return <EditModelRow provider={provider} model={model} onDone={() => setEditing(false)} />;
  }

  const hidden = model.hidden === true;
  return (
    <div
      // py matches the credential rows one section up — same anatomy (two-line row,
      // reveal-on-approach controls), same rhythm.
      className="slip group flex items-center gap-3 rounded-r3 px-3 py-2 hover:bg-s2"
      // Right-click is the row's second door to the SAME ⋯ menu (the credential-row
      // pattern) — no separate context menu to drift out of sync with it.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // The open menu is PORTALED, so its right-clicks bubble here through the React
        // tree (not the DOM). A click that isn't on the row itself must not reposition
        // the menu — menus don't get menus.
        if (e.target instanceof Node && !e.currentTarget.contains(e.target)) return;
        setMenuAt({ x: e.clientX, y: e.clientY });
        setMenuOpen(true);
      }}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className={cx('truncate text-sec', hidden ? 'text-s7' : 'text-s10')}>
            {entryLabel(model)}
          </span>
          {model.origin === 'custom' && (
            <span className="flex-none rounded-r1 border border-s5 px-1 font-mono text-caps text-s7">
              Custom
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 truncate font-mono text-meta text-s7">
          <span className="truncate">{model.id}</span>
          <span className="text-s6">·</span>
          <span className="truncate">{reasoningSummary(profileOf(model))}</span>
        </span>
      </span>

      {/* The everyday declutter — hide toggle, revealed on approach, visible while OFF
          because that IS the state worth seeing (mirrors the provider bench switch). */}
      <Tooltip label={hidden ? 'Show in the Pickers' : 'Hide from the Pickers'} side="top">
        <span
          className={cx(
            'slip flex',
            !hidden && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Toggle
            on={!hidden}
            onChange={(on) =>
              void surfaceWrite('change that model', setHidden(provider.id, model.id, !on))
            }
            aria-label={`${entryLabel(model)} in the pickers`}
          />
        </span>
      </Tooltip>

      <span
        className={cx(
          'slip',
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <RowMenu
          label={`${entryLabel(model)} actions`}
          open={menuOpen}
          onOpenChange={(next) => {
            setMenuOpen(next);
            if (!next) setMenuAt(undefined);
          }}
          anchorPoint={menuAt}
        >
          <MenuItem onClick={() => setEditing(true)}>Edit…</MenuItem>
          <MenuItem
            onClick={() =>
              void surfaceWrite('change that model', setHidden(provider.id, model.id, !hidden))
            }
          >
            {hidden ? 'Show in Pickers' : 'Hide from Pickers'}
          </MenuItem>
          {/* Confirm only for custom — a default re-adds from the catalog in two clicks. */}
          {model.origin === 'custom' ? (
            <MenuItem onClick={() => confirmRemove({ providerId: provider.id, id: model.id })}>
              <span className="text-crit">Remove…</span>
            </MenuItem>
          ) : (
            <MenuItem
              onClick={() =>
                void surfaceWrite('remove that model', removeModel(provider.id, model.id))
              }
            >
              <span className="text-crit">Remove</span>
            </MenuItem>
          )}
        </RowMenu>
      </span>
    </div>
  );
}

/* --------------------------------- reasoning editor --------------------------------- */

type ReasoningMode = ReasoningProfile['kind'];
// The key is the VALUE and travels into the profile; the string is only ever displayed.
const MODE_LABEL: Record<ReasoningMode, string> = {
  inherit: 'Inherit',
  effort: 'Effort ladder',
  thinking: 'Thinking',
  budget: 'Budget',
  none: 'None',
};
const MODES: ReasoningMode[] = ['inherit', 'effort', 'thinking', 'budget', 'none'];

/** The Advanced reasoning control (edit + create). Mode picks one of inherit/effort/thinking/
 *  budget/none; effort adds a low→max ladder, budget a token field. Never cages the backend —
 *  an invalid effort still surfaces live, never blocked. */
function ReasoningEditor({
  value,
  onChange,
}: {
  value: ReasoningProfile;
  onChange: (r: ReasoningProfile) => void;
}): React.JSX.Element {
  const pick = (mode: ReasoningMode): void => {
    if (mode === value.kind) return;
    if (mode === 'effort') onChange({ kind: 'effort', max: 'high' });
    else if (mode === 'budget') onChange({ kind: 'budget', tokens: 8000 });
    else if (mode === 'thinking') onChange({ kind: 'thinking' });
    else if (mode === 'none') onChange({ kind: 'none' });
    else onChange({ kind: 'inherit' });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-meta text-s7">Reasoning</span>
      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => pick(m)}
            className={cx(
              'slip slip-press cursor-pointer rounded-r2 border px-2 py-0.5 text-meta active:scale-[0.97]',
              m === value.kind
                ? 'border-s6 bg-s4 text-s12'
                : 'border-s4 text-s8 hover:border-s5 hover:text-s10',
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {value.kind === 'effort' && (
        <div className="flex items-center gap-1 pt-0.5">
          <span className="mr-1 font-mono text-meta text-s7">Up to</span>
          {EFFORTS.map((e) => {
            const within = EFFORTS.indexOf(e) <= EFFORTS.indexOf(value.max as Effort);
            return (
              <button
                key={e}
                type="button"
                onClick={() => onChange({ kind: 'effort', max: e })}
                className={cx(
                  'slip cursor-pointer rounded-r1 px-1.5 py-0.5 font-mono text-meta',
                  e === value.max
                    ? 'bg-s6 text-s12'
                    : within
                      ? 'bg-s4 text-s10'
                      : 'text-s7 hover:text-s9',
                )}
              >
                {e}
              </button>
            );
          })}
        </div>
      )}

      {value.kind === 'budget' && (
        <TextInput
          value={String(value.tokens)}
          onChange={(v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n > 0) onChange({ kind: 'budget', tokens: n });
          }}
          placeholder="8000"
          className="w-28"
        />
      )}
    </div>
  );
}

/* --------------------------------- inline forms --------------------------------- */

function EditModelRow({
  provider,
  model,
  onDone,
}: {
  provider: ProviderDescriptor;
  model: ModelEntry;
  onDone: () => void;
}): React.JSX.Element {
  const editModel = useModels((s) => s.editModel);
  const [label, setLabel] = useState(model.label ?? '');
  const [reasoning, setReasoning] = useState<ReasoningProfile>(profileOf(model));

  // An open inline form is a dismiss layer: Escape abandons IT first, wherever focus sits.
  useDismissLayer(true, onDone);

  const commit = (): void => {
    void surfaceWrite('save that model', editModel(provider.id, model.id, { label, reasoning }));
    onDone();
  };

  return (
    <div className="my-1 flex flex-col gap-3 rounded-r3 border border-s4 bg-s2 px-3 py-3">
      <span className="font-mono text-meta text-s7">{model.id}</span>
      <label className="flex flex-col gap-1.5 text-code text-s9">
        Label
        <TextInput
          autoFocus
          value={label}
          onChange={setLabel}
          onCommit={commit}
          placeholder={model.id}
        />
      </label>
      <ReasoningEditor value={reasoning} onChange={setReasoning} />
      <div className="flex justify-end gap-2">
        <Button variant="text" onClick={onDone}>
          esc
        </Button>
        <Button variant="quiet" onClick={commit}>
          Save
        </Button>
      </div>
    </div>
  );
}

function CreateCustomRow({
  provider,
  onDone,
}: {
  provider: ProviderDescriptor;
  onDone: () => void;
}): React.JSX.Element {
  const addCustom = useModels((s) => s.addCustom);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [reasoning, setReasoning] = useState<ReasoningProfile>({ kind: 'inherit' });

  useDismissLayer(true, onDone);

  const commit = (): void => {
    if (id.trim() === '') return;
    const entry: { id: string; label?: string; reasoning?: ReasoningProfile } = { id: id.trim() };
    if (label.trim() !== '') entry.label = label.trim();
    if (reasoning.kind !== 'inherit') entry.reasoning = reasoning;
    void surfaceWrite('add that model', addCustom(provider.id, entry));
    onDone();
  };

  return (
    <div className="mb-1.5 flex flex-col gap-3 rounded-r3 border border-s4 bg-s2 px-3 py-3">
      <span className="text-meta text-s7">Create a custom {provider.label} model</span>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1.5 text-code text-s9">
          Model id
          <TextInput
            autoFocus
            value={id}
            onChange={setId}
            onCommit={commit}
            placeholder="claude-opus-4-9"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-code text-s9">
          Label (optional)
          <TextInput value={label} onChange={setLabel} onCommit={commit} placeholder="opus 4.9" />
        </label>
      </div>
      <ReasoningEditor value={reasoning} onChange={setReasoning} />
      <div className="flex items-center gap-2 text-code text-s8">
        <StatusDot status="idle" />
        The id goes on the wire as-is. It is not validated, so an invalid one surfaces live rather
        than blocked.
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="text" onClick={onDone}>
          esc
        </Button>
        <Button variant="quiet" disabled={id.trim() === ''} onClick={commit}>
          Add Model
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------- the dialogs ----------------------------------- */

/** Add from the coa-owned default catalog — a dialog (a picker over a static set, not a form
 *  growing the list it sits above). Multi-select, count-carrying commit. Lives in the shell's
 *  exclusive dialog slot like every other modal (single-dialog rule). */
function AddFromDefaultsDialog({ provider }: { provider: ProviderDescriptor }): React.JSX.Element {
  const openFor = useShell((s) => s.addModelsProvider);
  const setOpen = useShell((s) => s.setAddModelsProvider);
  const list = useModels((s) => s.lists[provider.id] ?? NO_MODELS);
  const catalog = useModels((s) => s.catalog[provider.id] ?? NO_MODELS);
  const addFromDefaults = useModels((s) => s.addFromDefaults);
  const [picked, setPicked] = useState<string[]>([]);

  const open = openFor === provider.id;
  const offered = offerable(catalog, list);

  // A fresh open is a fresh pick — yesterday's selection is not a preference.
  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = (): void => setOpen(undefined);
  const commit = (): void => {
    if (picked.length > 0) {
      void surfaceWrite('add those models', addFromDefaults(provider.id, picked));
    }
    close();
  };

  return (
    <ModalShell open={open} onClose={close} aria-label="Add from defaults" className="w-md">
      <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
        <BrandMark spec={provider.mark} />
        <span className="text-sec font-semibold text-s11">Add from the coa catalog</span>
        <span className="ml-auto font-mono text-meta text-s7">{offered.length} available</span>
      </div>
      <div className="max-h-100 overflow-y-auto px-4 py-2">
        {offered.length === 0 ? (
          <div className="py-6 text-center text-sec text-s7">
            Every catalog model is already in your list.
          </div>
        ) : (
          offered.map((m) => {
            const on = picked.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className="slip flex w-full cursor-pointer items-center gap-2.5 rounded-r2 px-2 py-1.5 text-left hover:bg-s3"
              >
                <span
                  aria-hidden
                  className={cx(
                    'flex h-3.5 w-3.5 flex-none items-center justify-center rounded-r1 border text-caps',
                    on ? 'border-s10 bg-s10 text-s1' : 'border-s6 text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1 truncate text-sec text-s10">{entryLabel(m)}</span>
                <span className="truncate font-mono text-meta text-s7">{m.id}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button variant="quiet" disabled={picked.length === 0} onClick={commit}>
          Add {picked.length > 0 ? picked.length : ''}
        </Button>
      </div>
    </ModalShell>
  );
}

/** Removing a CUSTOM model is the destructive path — no catalog to bring it back — so it asks.
 *  The copy is honest about blast radius: anything already pinned to the id keeps running. */
function RemoveCustomConfirm({ provider }: { provider: ProviderDescriptor }): React.JSX.Element {
  const target = useShell((s) => s.confirmRemoveModel);
  const setConfirm = useShell((s) => s.setConfirmRemoveModel);
  const removeModel = useModels((s) => s.removeModel);
  const list = useModels((s) => s.lists[provider.id] ?? NO_MODELS);

  const model =
    target !== undefined && target.providerId === provider.id
      ? list.find((m) => m.id === target.id)
      : undefined;
  const close = (): void => setConfirm(undefined);

  return (
    <ModalShell
      open={model !== undefined}
      onClose={close}
      aria-label="Remove model"
      className="w-96"
    >
      {model !== undefined && (
        <>
          <div className="border-b border-s3 px-4 py-3 text-sec font-semibold text-s11">
            Remove {entryLabel(model)}?
          </div>
          <div className="px-4 py-4 text-code leading-relaxed text-s9">
            A custom {provider.label} model has no catalog to re-add it from, so removing it is
            permanent. Anything already pinned to{' '}
            <span className="font-mono text-s10">{model.id}</span> keeps running.
          </div>
          <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                void surfaceWrite('remove that model', removeModel(provider.id, model.id));
                close();
              }}
            >
              <span className="text-crit">Remove Model</span>
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
