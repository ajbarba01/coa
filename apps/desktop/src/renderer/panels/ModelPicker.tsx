import type { ModelDescriptor } from '@coa/console-viewmodel';
import { BrandMark, Combobox, StepSlider, cx, type ComboboxOption } from '@coa/console-kit';
import { COA_MARK, harnessLabel, harnessOf, type Harness } from './harness.js';
import { CLAUDE_MARK } from './providerMarks.js';

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

const PROVIDER_LABELS: Record<string, string> = { claude: 'Claude', deepseek: 'DeepSeek' };

/**
 * The picker label: the model's version — the first "·"-delimited segment of the
 * SDK description (e.g. "Opus 4.8"). The account exposes named aliases whose
 * version lives only in the description, so we surface it. When the display name
 * isn't already part of that version (the "Default (recommended)" alias), keep it
 * as a prefix; with no description, fall back to the display name, then the id.
 */
export function modelLabel(m: ModelDescriptor): string {
  const version = m.description?.split('·')[0]?.trim();
  if (version === undefined || version === '') return m.displayName ?? m.id;
  const name = m.displayName;
  if (name !== undefined && !version.toLowerCase().startsWith(name.toLowerCase())) {
    return `${name} · ${version}`;
  }
  return version;
}

/**
 * The picker label for a model in the MERGED (multi-provider) list — the model's
 * version prefixed with its backend (e.g. "DeepSeek · V4 Pro") so a combined list
 * reads clearly and stays searchable by provider. Untagged models show plainly.
 */
export function modelPickerLabel(m: ModelDescriptor): string {
  const base = modelLabel(m);
  if (m.provider === undefined) return base;
  const name = PROVIDER_LABELS[m.provider] ?? m.provider;
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

const HARNESS_RANK: Record<Harness, number> = { 'claude-code': 0, coa: 1 };

/** The model picker's options: every pickable model, grouped by the harness it
 *  actually runs on (Claude Code vs. coa's own scaffold) and marked with THAT
 *  harness's glyph — never the vendor's own logo, which would just repeat what
 *  `modelPickerLabel` already says in words. `Combobox` renders a group header
 *  wherever an option's group differs from its neighbour, so an interleaved input
 *  (a merged list doesn't promise providers arrive grouped) would fragment into
 *  repeated header blocks; sorting by harness first — Claude Code, then coa's
 *  scaffold, a STABLE sort so each harness keeps its own models in their original
 *  relative order — keeps every harness in one contiguous run. An emptied/
 *  still-loading list degrades honestly: the backend default runs, so the picker
 *  says so rather than opening on nothing (SC-1, D85).
 */
export function modelPickerOptions(
  models: ModelDescriptor[],
  currentModel: string | undefined,
): ComboboxOption[] {
  if (models.length > 0) {
    const sorted = [...models].sort(
      (a, b) => HARNESS_RANK[harnessOf(a.provider)] - HARNESS_RANK[harnessOf(b.provider)],
    );
    return sorted.map((m) => {
      const harness = harnessOf(m.provider);
      return {
        value: m.id,
        label: modelPickerLabel(m),
        group: harnessLabel(harness),
        leading: <BrandMark spec={harness === 'claude-code' ? CLAUDE_MARK : COA_MARK} size={15} />,
      };
    });
  }
  if (currentModel !== undefined) return [{ value: currentModel, label: currentModel }];
  return [{ value: '', label: 'Backend default' }];
}

/** The reasoning ladder and its three end captions. One renderer for both placements,
 *  so the surfaces cannot drift: the popup footer needs the popup's own padding, the
 *  in-flow placement inherits its container's. */
function EffortLadder({
  options,
  value,
  onChange,
  placement,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placement: 'footer' | 'inline';
}): React.JSX.Element {
  const current = options.find((o) => o.value === value);
  return (
    <div className={cx('flex flex-col gap-1', placement === 'footer' && 'px-3 pt-2 pb-3')}>
      <StepSlider
        stops={options.map((o) => o.value)}
        value={value}
        onChange={onChange}
        aria-label="Reasoning effort"
      />
      {/* A THREE-COLUMN GRID, not absolute positioning. Real stop names run long ("No
          thinking", "max"), and absolutely-positioned ends sit outside flow, so the
          centred current value had nothing to push against and collided with them. Each
          cell owns its own track and truncates inside it.
          The ends are sized to their CONTENT rather than to a third of the row: on the
          16.5rem rail the editor's two-column layout uses, an even third is narrower than
          "No thinking" and clipped a caption that had room to spare. `minmax(0,…)` keeps
          every track shrinkable, so a genuinely cramped row still degrades by truncating
          instead of overflowing. */}
      <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-baseline gap-1.5 font-mono text-meta text-s7">
        <span className="truncate">{options[0]?.label}</span>
        <span className="truncate text-center text-s9">{current?.label ?? value}</span>
        <span className="truncate text-right">{options[options.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export interface ModelPickerProps {
  models: ModelDescriptor[];
  value: string | undefined;
  onChange: (modelId: string) => void;
  /** The model's own ladder (`effortOptions`). Empty ⇒ no reasoning surface at all. */
  effortOptions: { value: string; label: string }[];
  effortValue: string;
  onEffortChange: (v: string) => void;
  /** `chip`: the composer shelf's dense trigger — no room for a ladder, so the stop is
   *  named on the trigger and the ladder rides the popup's footer. `bordered`: a field
   *  with room, so the ladder stays on the surface and the trigger names the model only
   *  (the ladder beneath already reports the stop; saying it twice is noise). */
  variant: 'chip' | 'bordered';
  disabled?: boolean;
}

export function ModelPicker({
  models,
  value,
  onChange,
  effortOptions,
  effortValue,
  onEffortChange,
  variant,
  disabled = false,
}: ModelPickerProps): React.JSX.Element {
  const options = modelPickerOptions(models, value);
  const current = options.find((o) => o.value === value);
  const effort = effortOptions.find((o) => o.value === effortValue);
  const name = current?.label ?? value ?? options[0]?.label ?? '';
  const triggerLabel =
    variant === 'chip' && effort !== undefined ? `${name} · ${effort.label}` : name;
  const hasEffort = effortOptions.length > 0;
  const ladder = (placement: 'footer' | 'inline'): React.JSX.Element => (
    <EffortLadder
      options={effortOptions}
      value={effortValue}
      onChange={onEffortChange}
      placement={placement}
    />
  );

  return (
    // As a field the picker claims the row it sits in (its caller is a flex container);
    // as a chip it hugs, so the composer's shelf keeps its layout.
    <div className={cx('flex min-w-0 flex-col gap-1', variant === 'bordered' && 'flex-1')}>
      <Combobox
        aria-label="Model"
        placeholder="Filter models…"
        value={value ?? options[0]?.value ?? ''}
        options={options}
        disabled={disabled}
        variant={variant}
        // As a field inside a panel the picker spans it; as a chip on the composer's
        // shelf it hugs its label.
        fullWidth={variant === 'bordered'}
        triggerLabel={triggerLabel}
        onChange={(id) => {
          // The empty-list "Backend default" row is a statement, not a value — picking it
          // must not write an empty model id onto the caller.
          if (id !== '') onChange(id);
        }}
        {...(variant === 'chip' && hasEffort ? { footer: ladder('footer') } : {})}
      />
      {variant === 'bordered' && hasEffort && ladder('inline')}
    </div>
  );
}
