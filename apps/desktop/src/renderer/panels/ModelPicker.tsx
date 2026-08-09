import { useState } from 'react';
import type { ModelDescriptor, ModelMetadata } from '@coa/console-viewmodel';
import {
  findModelMetadata,
  formatModalities,
  formatPerMillion,
  formatPricing,
  formatTokenLimit,
} from '@coa/console-viewmodel';
import {
  BrandMark,
  CapsLabel,
  Combobox,
  cx,
  type BrandMarkSpec,
  type ComboboxOption,
  type ComboboxRailItem,
} from '@coa/console-kit';
import { PROVIDERS, providerById } from './providers.js';
import { EffortLadder } from './ReasoningPicker.js';

/**
 * The console's ONE model-and-effort control. Both the composer's shelf and the agent
 * editor's "Runs on" field are this component; before it they were two different
 * controls doing one job (an unfiltered menu on one surface, a combobox plus a
 * hand-rolled ladder on the other), which is what let them drift apart.
 *
 * App-level rather than a kit member, on the `fields.tsx` / `resolvedSet.tsx` /
 * `RowMenu.tsx` precedent: it composes kit members but carries app knowledge — which
 * harness a provider runs on, and what that harness's mark is — that the kit does not own.
 */

/** The backend a model actually comes from. An untagged model resolves to Claude, the same
 *  `?? 'claude'` default the daemon applies at every other seam — see {@link harnessOf}. */
export function providerOf(m: ModelDescriptor): string {
  return m.provider ?? 'claude';
}

/** The backend's display name, from the one provider registry the auth surfaces render off —
 *  a provider we ship no row for still gets named, by its own id. */
function providerLabel(id: string): string {
  return providerById(id)?.label ?? id;
}

/** The backend's mark, from that same registry. An unregistered provider degrades to
 *  `BrandMark`'s monogram tile, which is what keeps "a new provider is one registry row" true. */
function providerMark(id: string): BrandMarkSpec {
  return providerById(id)?.mark ?? { name: providerLabel(id), color: 'var(--color-s10)' };
}

/** Every backend the offered models actually come from, in the provider registry's order
 *  (anything unregistered trails, first-seen). DERIVED, never the registry itself: a rail
 *  row for a backend with no models would be a dead end. */
export function modelProviders(models: ModelDescriptor[]): string[] {
  const present = new Set(models.map(providerOf));
  const known = PROVIDERS.filter((p) => present.has(p.id)).map((p) => p.id);
  return [...known, ...[...present].filter((id) => !known.includes(id))];
}

/** The rail's scope id meaning "don't narrow at all". Not a provider id, so it can never
 *  collide with one. */
const ALL_BACKENDS = '*';

/** Title-case a name a backend handed over uncased ("fable 5" → "Fable 5"). Only the FIRST
 *  letter of each word is touched, so a name that already carries its own casing survives
 *  intact — "V4 Pro", "LongCat-2.0", "GPT" are all fixed points. Presentation only: the id
 *  is what travels, and this never touches it. */
function titleCase(label: string): string {
  return label.replace(
    /(^|\s)(\S)/g,
    (_, lead: string, first: string) => lead + first.toUpperCase(),
  );
}

/**
 * The picker label: the model's version — the first "·"-delimited segment of the
 * SDK description (e.g. "Opus 4.8"). The account exposes named aliases whose
 * version lives only in the description, so we surface it. When the display name
 * isn't already part of that version (the "Default (recommended)" alias), keep it
 * as a prefix; with no description, fall back to the display name, then the id.
 *
 * Anything that came from a NAME is title-cased. Backends are inconsistent about it —
 * one hands over "fable 5", the next "V4 Pro" — and a list mixing the two reads like a
 * bug in the app rather than a difference between vendors. A bare id is left exactly as
 * it is: an id is an identifier, not a name, and casing "claude-sonnet-4-6" would invent
 * a name the backend never gave.
 */
export function modelLabel(m: ModelDescriptor): string {
  const version = m.description?.split('·')[0]?.trim();
  if (version === undefined || version === '') {
    return m.displayName === undefined ? m.id : titleCase(m.displayName);
  }
  const name = m.displayName;
  if (name !== undefined && !version.toLowerCase().startsWith(name.toLowerCase())) {
    return titleCase(`${name} · ${version}`);
  }
  return titleCase(version);
}

/**
 * The picker label for a model in the MERGED (multi-provider) list — the model's
 * version prefixed with its backend (e.g. "DeepSeek · V4 Pro") so a combined list
 * reads clearly and stays searchable by provider. Untagged models show plainly.
 */
export function modelPickerLabel(m: ModelDescriptor): string {
  const base = modelLabel(m);
  if (m.provider === undefined) return base;
  const name = providerLabel(m.provider);
  // A DISPLAY name that already carries its backend ("DeepSeek V4 Pro") must not wear it
  // twice. A bare id falling through still earns the prefix — that is the only tag it has.
  if (base !== m.id && base.toLowerCase().startsWith(name.toLowerCase())) return base;
  return `${name} · ${base}`;
}

/**
 * The models offered in the picker. The SDK's `default` alias points at the
 * account's default model, so it duplicates a named entry — hide it (leaving a
 * model unset already means "let the backend choose the default").
 */
export function pickableModels(models: ModelDescriptor[]): ModelDescriptor[] {
  return models.filter((m) => m.id !== 'default');
}

/** The model picker's options: the models handed in, grouped and marked by the BACKEND
 *  they come from — the same slicing the rail offers, so the two chrome surfaces name one
 *  vocabulary instead of two. (Which harness actually runs a model is a different
 *  question; the agent editor's Runs-on field is the one place that asks it.)
 *  `Combobox` renders a group header wherever an option's group differs from its
 *  neighbour, so an interleaved input (a merged list doesn't promise backends arrive
 *  grouped) would fragment into repeated header blocks; sorting by backend first, in the
 *  rail's own order and STABLY so each backend keeps its models in their original relative
 *  order, keeps every backend in one contiguous run.
 *
 *  Rows wear the bare model name: under its backend's header, beside its backend's mark,
 *  a row that also spelled the backend out would say it three times. The TRIGGER has
 *  neither, so it keeps the qualified name.
 *
 *  An emptied/still-loading list degrades honestly: the backend default runs, so the
 *  picker says so rather than opening on nothing (advisory, and absence degrades to a pass-through).
 */
export function modelPickerOptions(
  models: ModelDescriptor[],
  currentModel: string | undefined,
): ComboboxOption[] {
  if (models.length > 0) {
    const order = modelProviders(models);
    const sorted = [...models].sort(
      (a, b) => order.indexOf(providerOf(a)) - order.indexOf(providerOf(b)),
    );
    return sorted.map((m) => ({
      value: m.id,
      label: modelLabel(m),
      group: providerLabel(providerOf(m)),
      leading: <BrandMark spec={providerMark(providerOf(m))} size={15} />,
    }));
  }
  if (currentModel !== undefined) return [{ value: currentModel, label: currentModel }];
  return [{ value: '', label: 'Backend default' }];
}

/** The rail's scopes: every backend the models come from, behind an all-backends row.
 *  Fewer than two backends ⇒ no rail at all, since there would be nothing to pick. */
export function backendRailItems(models: ModelDescriptor[]): ComboboxRailItem[] {
  const providers = modelProviders(models);
  if (providers.length < 2) return [];
  return [
    {
      id: ALL_BACKENDS,
      label: 'All backends',
      // The asterisk is the wildcard every shell and glob already taught: "match them
      // all". No vendor owns it, which is exactly why it can stand above all of them.
      // Set larger than the 15px marks it sits above: a glyph is mostly whitespace where
      // a logo fills its box, so matching their point size reads a size smaller.
      leading: (
        <span aria-hidden className="font-mono text-[21px] leading-none">
          ✳
        </span>
      ),
    },
    ...providers.map((id) => ({
      id,
      label: providerLabel(id),
      leading: <BrandMark spec={providerMark(id)} size={15} />,
    })),
  ];
}

/** One fact row on the overview card. Renders nothing without a value — absent
 *  metadata renders as absent, never as a placeholder. */
function CardRow({ label, value }: { label: string; value?: string | undefined }): React.ReactNode {
  if (value === undefined) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-0.5">
      <span className="text-fine text-s7">{label}</span>
      <span className="text-right font-mono text-meta text-s10">{value}</span>
    </div>
  );
}

/** The merge tier's honest provenance line, for the card's quiet footer. */
function sourceLabel(source: ModelMetadata['source']): string | undefined {
  if (source === 'models-dev') return 'via models.dev';
  if (source === 'openrouter') return 'via OpenRouter';
  if (source === 'static') return 'built-in data';
  return undefined;
}

/**
 * The hover overview card — the ONE place a model's real metadata lives (rows stay
 * clean of inline badges). Every row is real catalog data; a model the catalog has
 * nothing on says so in one honest line rather than showing fabricated defaults.
 * Exported for direct testing.
 */
export function ModelOverviewCard({
  model,
  row,
}: {
  model: ModelDescriptor;
  row: ModelMetadata | undefined;
}): React.JSX.Element {
  const provider = providerOf(model);
  const cacheRead = row?.pricing?.cacheReadPerMillion;
  const known =
    row !== undefined &&
    (row.contextWindow !== undefined ||
      row.maxOutputTokens !== undefined ||
      row.modalities !== undefined ||
      row.pricing !== undefined ||
      row.reasoning !== undefined ||
      row.knowledgeCutoff !== undefined);
  const source = known ? sourceLabel(row.source) : undefined;
  return (
    <div data-model-overview className="py-1">
      <div className="flex items-center gap-2 px-3 pt-1.5 pb-1">
        <BrandMark spec={providerMark(provider)} size={15} />
        <span className="min-w-0 truncate font-[550] text-[12px] text-s11">
          {modelLabel(model)}
        </span>
      </div>
      <div className="px-3 pb-1 font-mono text-fine break-all text-s6">{model.id}</div>
      {!known ? (
        <div className="px-3 py-1.5 text-fine text-s7">No metadata for this model.</div>
      ) : (
        <div className="border-t border-s3 pt-1 pb-0.5">
          <CapsLabel>Model info</CapsLabel>
          <CardRow
            label="Context"
            value={
              row.contextWindow !== undefined
                ? `${formatTokenLimit(row.contextWindow)} tokens`
                : undefined
            }
          />
          <CardRow
            label="Max output"
            value={
              row.maxOutputTokens !== undefined
                ? `${formatTokenLimit(row.maxOutputTokens)} tokens`
                : undefined
            }
          />
          <CardRow label="Modalities" value={formatModalities(row.modalities)} />
          <CardRow label="Pricing" value={formatPricing(row.pricing)} />
          <CardRow
            label="Cache read"
            value={cacheRead !== undefined ? `${formatPerMillion(cacheRead)} /M tokens` : undefined}
          />
          <CardRow
            label="Reasoning"
            value={row.reasoning === undefined ? undefined : row.reasoning ? 'Yes' : 'No'}
          />
          <CardRow label="Knowledge cutoff" value={row.knowledgeCutoff} />
          {source !== undefined && (
            <div className="px-3 pt-1 pb-0.5 text-fine text-s6">{source}</div>
          )}
        </div>
      )}
    </div>
  );
}

export interface ModelPickerProps {
  models: ModelDescriptor[];
  value: string | undefined;
  onChange: (modelId: string) => void;
  /** Per-model catalog rows for the hover overview card; absent ⇒ no card (the
   *  agent editor's field keeps its current, card-less behavior). */
  metadata?: ModelMetadata[];
  /** The model's own ladder — the `bordered` field's second axis, rendered beneath it.
   *  Absent or empty ⇒ no reasoning surface (a thinking-only model has no ladder to
   *  offer). The `chip` variant never renders one: on the composer's shelf reasoning is
   *  its own control, so hiding it inside the model popup would bury a second axis
   *  behind a choice that has nothing to do with it. */
  effortOptions?: { value: string; label: string }[];
  effortValue?: string;
  onEffortChange?: (v: string) => void;
  /** `chip`: the composer shelf's dense trigger, model only. `bordered`: a field with
   *  room, so the ladder rides beneath it on the same surface. */
  variant: 'chip' | 'bordered';
  disabled?: boolean;
}

export function ModelPicker({
  models,
  value,
  onChange,
  metadata,
  effortOptions = [],
  effortValue = '',
  onEffortChange,
  variant,
  disabled = false,
}: ModelPickerProps): React.JSX.Element {
  // The rail's scope is sticky across opens — it is visible chrome with an always-present
  // way back out, so leaving it where it was put beats resetting the surface under someone
  // who is working inside one backend. A scope whose backend stops being offered (its
  // account was removed) resolves back to all, so the list can never open onto "No match".
  const [scope, setScope] = useState(ALL_BACKENDS);
  const railItems = backendRailItems(models);
  const activeScope = railItems.some((i) => i.id === scope) ? scope : ALL_BACKENDS;

  // Two lists, deliberately: the trigger names the CURRENT model, which the rail may well
  // have narrowed the visible list past.
  const options = modelPickerOptions(models, value);
  const shown =
    activeScope === ALL_BACKENDS ? models : models.filter((m) => providerOf(m) === activeScope);
  const visible = modelPickerOptions(shown, value);

  const current = options.find((o) => o.value === value);
  const triggerLabel = current?.label ?? value ?? options[0]?.label ?? '';
  // The trigger stands alone — no header over it, no column of marks beside it — so it
  // carries the backend itself, as the mark rather than as another word.
  const currentModel = models.find((m) => m.id === value);
  const hasEffort = variant === 'bordered' && effortOptions.length > 0;
  const rail =
    railItems.length > 0
      ? { items: railItems, value: activeScope, onChange: setScope, label: 'Backend' }
      : undefined;

  return (
    // As a field the picker claims the row it sits in (its caller is a flex container);
    // as a chip it hugs, so the composer's shelf keeps its layout.
    <div className={cx('flex min-w-0 flex-col gap-1', variant === 'bordered' && 'flex-1')}>
      <Combobox
        aria-label="Model"
        placeholder="Filter models…"
        value={value ?? options[0]?.value ?? ''}
        options={visible}
        disabled={disabled}
        variant={variant}
        {...(rail !== undefined ? { rail } : {})}
        // As a field inside a panel the picker spans it; as a chip on the composer's
        // shelf it hugs its label.
        fullWidth={variant === 'bordered'}
        triggerLabel={triggerLabel}
        {...(currentModel !== undefined
          ? {
              triggerLeading: <BrandMark spec={providerMark(providerOf(currentModel))} size={14} />,
            }
          : {})}
        // The chip sits in a right-packed control row, so its LEFT edge moves whenever its
        // own label changes width — the popup hangs from the edge that holds still.
        align={variant === 'chip' ? 'end' : 'start'}
        {...(variant === 'chip' ? { tooltip: { label: 'Model', side: 'top' as const } } : {})}
        onChange={(id) => {
          // The empty-list "Backend default" row is a statement, not a value — picking it
          // must not write an empty model id onto the caller.
          if (id !== '') onChange(id);
        }}
        {...(metadata !== undefined
          ? {
              // The hover overview card (detail is proximity): whatever row the cursor
              // rests on shows its REAL metadata beside the popup; the rows themselves
              // stay clean of inline badges.
              detail: (o: ComboboxOption) => {
                const m = models.find((candidate) => candidate.id === o.value);
                if (m === undefined) return null;
                return (
                  <ModelOverviewCard
                    model={m}
                    row={findModelMetadata(metadata, providerOf(m), m.id)}
                  />
                );
              },
            }
          : {})}
      />
      {hasEffort && (
        <EffortLadder
          options={effortOptions}
          value={effortValue}
          onChange={(v) => onEffortChange?.(v)}
        />
      )}
    </div>
  );
}
