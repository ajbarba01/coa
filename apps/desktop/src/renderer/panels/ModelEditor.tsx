import { Button, CapsLabel, MenuItem, PopoverCard, StatusDot, Toggle, Tooltip, cx } from '@coa/console-kit';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { RISE, SLIP_ENTER } from './motion.js';
import {
  EFFORTS,
  defaultCatalog,
  entryLabel,
  profileOf,
  reasoningSummary,
  useMockModels,
  type Effort,
  type ModelEntry,
  type ReasoningProfile,
} from './mockModels.js';
import type { ProviderDescriptor } from './providers.js';

/**
 * The per-provider MODEL EDITOR — the surface for the "editable model list as SOT" design. The
 * user's list is authoritative for both the in-chat chip and the agent picker; here they add
 * from the coa-owned default catalog, create a custom id, edit a model's label + reasoning
 * profile, hide it from the pickers (everyday declutter), or remove it. Hide and remove are
 * distinct on purpose (hide = out of my pickers; remove = out of my list), and remove confirms
 * only for a CUSTOM model — a default is two clicks from being re-added, a custom has no
 * catalog to come back from.
 *
 * MOCKUP: reads the renderer-only `useMockModels` spine, not the (unbuilt) ModelCatalogStore.
 */

/** Reactive per-provider list, materialising the catalog when the user's list is untouched. */
function useProviderModels(providerId: string): ModelEntry[] {
  const raw = useMockModels((s) => s.lists[providerId]);
  return raw ?? defaultCatalog(providerId);
}

export function ModelsSection({ provider }: { provider: ProviderDescriptor }): React.JSX.Element {
  const seedIfNeeded = useMockModels((s) => s.seedIfNeeded);
  const models = useProviderModels(provider.id);
  const [mode, setMode] = useState<'idle' | 'defaults' | 'custom'>('idle');

  // First touch materialises the defaults (seeding B) so an edit has a list to write to.
  useEffect(() => seedIfNeeded(provider.id), [provider.id, seedIfNeeded]);

  const hiddenCount = models.filter((m) => m.hidden === true).length;

  return (
    <>
      <div className="mt-7 mb-1.5 flex items-baseline border-b border-s3 pb-1.5">
        <CapsLabel className="px-0 pt-0">models</CapsLabel>
        <span className="ml-2 font-mono text-meta text-s7">{models.length}</span>
        {hiddenCount > 0 && (
          <span className="ml-2 font-mono text-meta text-s7">{hiddenCount} hidden</span>
        )}
        <AddMenu onAddDefaults={() => setMode('defaults')} onCreateCustom={() => setMode('custom')} />
      </div>

      <AnimatePresence initial={false}>
        {mode === 'defaults' && (
          <motion.div
            key="defaults"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SLIP_ENTER}
            className="overflow-hidden"
          >
            <AddFromDefaultsPanel provider={provider} onDone={() => setMode('idle')} />
          </motion.div>
        )}
        {mode === 'custom' && (
          <motion.div
            key="custom"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SLIP_ENTER}
            className="overflow-hidden"
          >
            <CreateCustomRow provider={provider} onDone={() => setMode('idle')} />
          </motion.div>
        )}
      </AnimatePresence>

      {models.length === 0 && mode === 'idle' && (
        <div className="py-6 text-center text-sec text-s7">
          no models — the picker falls back to {provider.label}&apos;s backend default
        </div>
      )}

      <AnimatePresence initial={false}>
        {models.map((m) => (
          <motion.div key={m.id} {...RISE}>
            <ModelRow provider={provider} model={m} />
          </motion.div>
        ))}
      </AnimatePresence>
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
          + add
        </Button>
      }
    >
      <div onClick={() => setOpen(false)}>
        <MenuItem onClick={onAddDefaults}>
          <span className="flex flex-col gap-px">
            <span className="text-sec text-s11">add from defaults…</span>
            <span className="text-meta text-s7">coa&apos;s curated catalog</span>
          </span>
        </MenuItem>
        <MenuItem onClick={onCreateCustom}>
          <span className="flex flex-col gap-px">
            <span className="text-sec text-s11">create custom…</span>
            <span className="text-meta text-s7">any id the backend accepts</span>
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
  const setHidden = useMockModels((s) => s.setHidden);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return <EditModelRow provider={provider} model={model} onDone={() => setEditing(false)} />;
  }

  const hidden = model.hidden === true;
  return (
    <div className="slip group flex items-center gap-3 rounded-r3 px-3 py-1.5 hover:bg-s2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className={cx('truncate text-sec', hidden ? 'text-s7' : 'text-s10')}>
            {entryLabel(model)}
          </span>
          {model.origin === 'custom' && (
            <span className="flex-none rounded-r1 border border-s5 px-1 font-mono text-[9px] text-s7">
              custom
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 truncate font-mono text-meta text-s7">
          <span className="truncate">{model.id}</span>
          <span className="text-s6">·</span>
          <span className="truncate">{reasoningSummary(profileOf(model))}</span>
        </span>
      </span>

      {/* The everyday declutter — hide toggle, revealed on approach, visible while OFF because
          that IS the state worth seeing (mirrors the provider bench switch). */}
      <Tooltip label={hidden ? 'show in the pickers' : 'hide from the pickers'} side="top">
        <span
          className={cx(
            'slip flex',
            !hidden && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Toggle
            on={!hidden}
            onChange={(on) => setHidden(provider.id, model.id, !on)}
            aria-label={`${entryLabel(model)} in the pickers`}
          />
        </span>
      </Tooltip>

      <RowMenu label={`${entryLabel(model)} actions`}>
        <MenuItem onClick={() => setEditing(true)}>edit…</MenuItem>
        <MenuItem onClick={() => setHidden(provider.id, model.id, !hidden)}>
          {hidden ? 'show in pickers' : 'hide from pickers'}
        </MenuItem>
        {/* Confirm only for custom — a default re-adds from the catalog in two clicks. */}
        {model.origin === 'custom' ? (
          <MenuItem onClick={() => setConfirming(true)}>
            <span className="text-crit">remove…</span>
          </MenuItem>
        ) : (
          <RemoveDefault providerId={provider.id} model={model} />
        )}
      </RowMenu>

      <RemoveCustomConfirm
        open={confirming}
        provider={provider}
        model={model}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

/** A default's remove is unconfirmed (re-addable), so it acts straight from the menu. */
function RemoveDefault({
  providerId,
  model,
}: {
  providerId: string;
  model: ModelEntry;
}): React.JSX.Element {
  const removeModel = useMockModels((s) => s.removeModel);
  return (
    <MenuItem onClick={() => removeModel(providerId, model.id)}>
      <span className="text-crit">remove</span>
    </MenuItem>
  );
}

/* --------------------------------- reasoning editor --------------------------------- */

type ReasoningMode = ReasoningProfile['kind'];
const MODE_LABEL: Record<ReasoningMode, string> = {
  inherit: 'inherit',
  effort: 'effort ladder',
  thinking: 'thinking',
  budget: 'budget',
  none: 'none',
};
const MODES: ReasoningMode[] = ['inherit', 'effort', 'thinking', 'budget', 'none'];

/** The Advanced reasoning control (edit + create). Mode picks one of inherit/effort/thinking/
 *  budget/none; effort adds a low→max ladder, budget a token field. Faithful to the entry's
 *  reasoning profile without ever caging the backend (an invalid effort still surfaces live). */
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
      <span className="text-meta text-s7">reasoning</span>
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
          <span className="mr-1 font-mono text-meta text-s7">up to</span>
          {EFFORTS.map((e) => {
            const within = EFFORTS.indexOf(e) <= EFFORTS.indexOf(value.max);
            return (
              <button
                key={e}
                type="button"
                onClick={() => onChange({ kind: 'effort', max: e as Effort })}
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
  const editModel = useMockModels((s) => s.editModel);
  const [label, setLabel] = useState(model.label ?? '');
  const [reasoning, setReasoning] = useState<ReasoningProfile>(profileOf(model));

  const commit = (): void => {
    editModel(provider.id, model.id, { label, reasoning });
    onDone();
  };

  return (
    <div className="my-1 flex flex-col gap-3 rounded-r3 border border-s4 bg-s2 px-3 py-3">
      <span className="font-mono text-meta text-s7">{model.id}</span>
      <label className="flex flex-col gap-1.5 text-code text-s9">
        label
        <TextInput value={label} onChange={setLabel} placeholder={model.id} />
      </label>
      <ReasoningEditor value={reasoning} onChange={setReasoning} />
      <div className="flex justify-end gap-2">
        <Button variant="text" onClick={onDone}>
          esc
        </Button>
        <Button variant="quiet" onClick={commit}>
          save
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
  const addCustom = useMockModels((s) => s.addCustom);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [reasoning, setReasoning] = useState<ReasoningProfile>({ kind: 'inherit' });

  const commit = (): void => {
    if (id.trim() === '') return;
    const entry: { id: string; label?: string; reasoning?: ReasoningProfile } = { id: id.trim() };
    if (label.trim() !== '') entry.label = label.trim();
    if (reasoning.kind !== 'inherit') entry.reasoning = reasoning;
    addCustom(provider.id, entry);
    onDone();
  };

  return (
    <div className="mb-1.5 flex flex-col gap-3 rounded-r3 border border-s4 bg-s2 px-3 py-3">
      <span className="text-meta text-s7">create a custom {provider.label} model</span>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1.5 text-code text-s9">
          model id
          <TextInput autoFocus value={id} onChange={setId} onCommit={commit} placeholder="claude-opus-4-9" />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-code text-s9">
          label (optional)
          <TextInput value={label} onChange={setLabel} onCommit={commit} placeholder="opus 4.9" />
        </label>
      </div>
      <ReasoningEditor value={reasoning} onChange={setReasoning} />
      <div className="flex items-center gap-2 text-code text-s8">
        <StatusDot status="idle" />
        the id goes on the wire as-is — coa never checks it; an invalid one surfaces live, never blocked.
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="text" onClick={onDone}>
          esc
        </Button>
        <Button variant="quiet" disabled={id.trim() === ''} onClick={commit}>
          add model
        </Button>
      </div>
    </div>
  );
}

/** Add from the coa-owned default catalog — the models not yet in the list, multi-select. */
function AddFromDefaultsPanel({
  provider,
  onDone,
}: {
  provider: ProviderDescriptor;
  onDone: () => void;
}): React.JSX.Element {
  const list = useProviderModels(provider.id);
  const addFromDefaults = useMockModels((s) => s.addFromDefaults);
  const have = new Set(list.map((m) => m.id));
  const offerable = defaultCatalog(provider.id).filter((m) => !have.has(m.id));
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const commit = (): void => {
    if (picked.length > 0) addFromDefaults(provider.id, picked);
    onDone();
  };

  return (
    <div className="mb-1.5 flex flex-col gap-2 rounded-r3 border border-s4 bg-s2 px-3 py-3">
      <span className="text-meta text-s7">add from the coa catalog</span>
      {offerable.length === 0 ? (
        <div className="py-2 text-center text-sec text-s7">
          every catalog model is already in your list
        </div>
      ) : (
        <div className="flex flex-col">
          {offerable.map((m) => {
            const on = picked.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className="slip flex cursor-pointer items-center gap-2.5 rounded-r2 px-2 py-1.5 text-left hover:bg-s3"
              >
                <span
                  aria-hidden
                  className={cx(
                    'flex h-3.5 w-3.5 flex-none items-center justify-center rounded-r1 border text-[8px]',
                    on ? 'border-s10 bg-s10 text-s1' : 'border-s6 text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1 truncate text-sec text-s10">{entryLabel(m)}</span>
                <span className="truncate font-mono text-meta text-s7">{m.id}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="text" onClick={onDone}>
          esc
        </Button>
        <Button variant="quiet" disabled={picked.length === 0} onClick={commit}>
          add {picked.length > 0 ? picked.length : ''}
        </Button>
      </div>
    </div>
  );
}

/** Removing a CUSTOM model is the destructive path — no catalog to bring it back — so it asks. */
function RemoveCustomConfirm({
  open,
  provider,
  model,
  onClose,
}: {
  open: boolean;
  provider: ProviderDescriptor;
  model: ModelEntry;
  onClose: () => void;
}): React.JSX.Element | null {
  const removeModel = useMockModels((s) => s.removeModel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-88 rounded-r4 border border-s5 bg-s2 shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-s3 px-4 py-3 text-sec font-semibold text-s11">
          remove {entryLabel(model)}?
        </div>
        <div className="px-4 py-4 text-code leading-relaxed text-s9">
          It&apos;s a custom {provider.label} model, so there&apos;s no catalog to re-add it from —
          removing it is permanent. Any session already pinned to <span className="font-mono text-s10">{model.id}</span> keeps running.
        </div>
        <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
          <Button variant="outline" onClick={onClose}>
            cancel
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              removeModel(provider.id, model.id);
              onClose();
            }}
          >
            <span className="text-crit">remove model</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- primitives --------------------------------- */

function RowMenu({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="w-44"
      trigger={
        <button
          type="button"
          aria-label={label}
          className="slip flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-r2 text-s7 opacity-0 group-hover:opacity-100 hover:bg-s4 hover:text-s11 focus-visible:opacity-100"
        >
          ⋯
        </button>
      }
    >
      <div onClick={() => setOpen(false)}>{children}</div>
    </PopoverCard>
  );
}

function TextInput({
  value,
  onChange,
  onCommit,
  placeholder,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <input
      autoFocus={autoFocus}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit?.();
      }}
      className={cx(
        'slip min-w-0 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7',
        className,
      )}
    />
  );
}
