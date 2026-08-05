import { useEffect, useRef, useState } from 'react';
import type {
  AgentColor,
  AgentDiagnostic,
  AgentIcon,
  AgentSummary,
  ClaudeReasoning,
  ModelDescriptor,
  PackageSummary,
  RoleSummary,
} from '@coa/console-viewmodel';
import {
  AGENT_COLOR_NAMES,
  AGENT_ICON_NAMES,
  effortOptions,
  reasoningValue,
  toReasoning,
} from '@coa/console-viewmodel';
import {
  BrandMark,
  Button,
  CapsLabel,
  Icon,
  InlineMessage,
  MenuItem,
  ModalShell,
  PopoverCard,
  Tooltip,
  cx,
  useDismissLayer,
} from '@coa/console-kit';
import { AddPicker } from './AddPicker.js';
import { COA_MARK, harnessBlurb, harnessLabel, harnessOf } from './harness.js';
import { ModelPicker, pickableModels } from './ModelPicker.js';
import { Panel } from './Panel.js';
import { CLAUDE_MARK } from './providerMarks.js';
import {
  Bot,
  BookOpen,
  Bug,
  Compass,
  Database,
  Eye,
  FlaskConical,
  GitBranch,
  Hammer,
  Layers,
  PenTool,
  Search,
  Shield,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { NO_DRAG } from '../shell/appRegion.js';
import { useConsoleState } from '../shell/consoleStore.js';
import { useAgentsUi } from './agentsUi.js';
import { TEXT_INPUT_CLASS, TextInput } from './fields.js';
import { RISE } from './motion.js';
import { RowMenu } from './RowMenu.js';
import {
  SetRow,
  includedPackageIds,
  membershipSource,
  packageAdvisories,
  packageMembership,
  reachOf,
  togglePackage,
  type Membership,
} from './resolvedSet.js';
import { SkeletonLines, SurfaceEmpty, SurfaceError } from './surfaceStates.js';
import { useNarrow } from './useNarrow.js';
import type { ConsoleState } from './state.js';

// The model-picking vocabulary lives with the picker itself now; re-exported here so the
// surface stays the one import site for anything about an agent.
export { modelLabel, modelPickerLabel, modelPickerOptions, pickableModels } from './ModelPicker.js';

/**
 * Keep a reasoning selection valid across a model switch: unchanged when the
 * newly-selected model's own ladder (`effortOptions`, the shared seam the chat
 * composer already reads through) still offers the current stop; otherwise fall
 * back to that ladder's first stop. A model with no reasoning surface at all
 * (Haiku, or one not yet resolved from a still-loading list) clears it entirely —
 * there is nothing to clamp against.
 */
export function clampReasoning(
  reasoning: ClaudeReasoning | undefined,
  model: ModelDescriptor | undefined,
): ClaudeReasoning | undefined {
  const options = effortOptions(model);
  if (options.length === 0) return undefined;
  const value = reasoningValue(reasoning);
  return options.some((o) => o.value === value) ? reasoning : toReasoning(options[0]!.value);
}

export type AgentsVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty'; createAgent: (scope: 'project' | 'personal') => void }
  | {
      status: 'ready';
      agents: AgentSummary[];
      selected: AgentSummary;
      models: ModelDescriptor[];
      roles: RoleSummary[];
      packages: PackageSummary[];
      pinned: string[];
      selectAgent: (ref: string) => void;
      createAgent: (scope: 'project' | 'personal') => void;
      updateAgent: (ref: string, patch: Partial<Omit<AgentSummary, 'ref'>>) => void;
      deleteAgent: (ref: string) => void;
      togglePinAgent: (ref: string) => void;
    };

/** Pure: the editor opens on ui.selectedAgentRef, falling back to the first agent. */
export function selectAgentsVm(state: ConsoleState): AgentsVm {
  const r = state.data.agents;
  if (r.status !== 'ok') return r;
  const agents = r.value;
  const { selectAgent, createAgent, updateAgent, deleteAgent, togglePinAgent } = state.actions;
  if (agents.length === 0) return { status: 'empty', createAgent };
  const selected = agents.find((a) => a.ref === state.ui.selectedAgentRef) ?? agents[0]!;
  const models = state.data.models.status === 'ok' ? pickableModels(state.data.models.value) : [];
  const roles = state.data.roles.status === 'ok' ? state.data.roles.value : [];
  const packages = state.data.packages.status === 'ok' ? state.data.packages.value : [];
  return {
    status: 'ready',
    agents,
    selected,
    models,
    roles,
    packages,
    pinned: state.ui.settings.pinnedAgents,
    selectAgent,
    createAgent,
    updateAgent,
    deleteAgent,
    togglePinAgent,
  };
}

/** Pure: does this agent match the filter query — by name, ref, model (so a backend
 *  name finds its agents), or an assigned role's name (resolved through the catalogue,
 *  since the agent itself only carries role ids)? An empty query matches everything. */
export function matchesAgent(a: AgentSummary, query: string, roles: RoleSummary[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const roleNames = (a.roles ?? []).map((id) => roles.find((r) => r.id === id)?.name ?? id);
  return [a.name, a.ref, a.model, ...roleNames].some(
    (s) => s !== undefined && s.toLowerCase().includes(q),
  );
}

/* -------------------------------- identity vocabulary -------------------------------- */

/** The curated agent glyph vocabulary — Lucide marks over the console-viewmodel wire
 *  enum (`AGENT_ICON_NAMES`). This is a bounded, app-specific vocabulary rather than a
 *  general icon, so the kit doesn't carry it; the visual mapping lives here, same as
 *  the identity color classes below. */
const AGENT_GLYPHS: Record<AgentIcon, LucideIcon> = {
  bot: Bot,
  hammer: Hammer,
  wrench: Wrench,
  flask: FlaskConical,
  shield: Shield,
  book: BookOpen,
  bug: Bug,
  search: Search,
  pen: PenTool,
  branch: GitBranch,
  terminal: SquareTerminal,
  database: Database,
  layers: Layers,
  eye: Eye,
  compass: Compass,
  sparkles: Sparkles,
};

/** Categorical identity colors. The `agent-*` tokens live in the kit's theme scale, so
 *  these Tailwind utility classes resolve from the same place every other colour does. */
const AGENT_TINT: Record<AgentColor, string> = {
  slate: 'text-agent-slate bg-agent-slate/15',
  sky: 'text-agent-sky bg-agent-sky/15',
  blue: 'text-agent-blue bg-agent-blue/15',
  teal: 'text-agent-teal bg-agent-teal/15',
  green: 'text-agent-green bg-agent-green/15',
  mauve: 'text-agent-mauve bg-agent-mauve/15',
  violet: 'text-agent-violet bg-agent-violet/15',
  coral: 'text-agent-coral bg-agent-coral/15',
};
const AGENT_SOLID: Record<AgentColor, string> = {
  slate: 'bg-agent-slate',
  sky: 'bg-agent-sky',
  blue: 'bg-agent-blue',
  teal: 'bg-agent-teal',
  green: 'bg-agent-green',
  mauve: 'bg-agent-mauve',
  violet: 'bg-agent-violet',
  coral: 'bg-agent-coral',
};

function AgentGlyph({
  icon,
  color,
  size = 'md',
}: {
  icon: AgentIcon;
  color: AgentColor;
  size?: 'sm' | 'md' | 'lg';
}): React.JSX.Element {
  const Glyph = AGENT_GLYPHS[icon];
  const box =
    size === 'lg'
      ? 'h-10 w-10 rounded-r3'
      : size === 'md'
        ? 'h-7 w-7 rounded-r2'
        : 'h-5 w-5 rounded-r1';
  const glyphPx = size === 'lg' ? 20 : size === 'md' ? 15 : 12;
  return (
    <span
      aria-hidden
      className={cx('inline-flex flex-none items-center justify-center', box, AGENT_TINT[color])}
    >
      <Glyph aria-hidden size={glyphPx} />
    </span>
  );
}

/** Choose an agent's icon and color from the curated vocabulary — the trigger IS the
 *  live identity chip, so a pick previews instantly (the parent owns the value and
 *  re-renders the chip). */
function IdentityPicker({
  icon,
  color,
  label,
  onIconChange,
  onColorChange,
  readOnly = false,
}: {
  icon: AgentIcon;
  color: AgentColor;
  label: string;
  onIconChange: (icon: AgentIcon) => void;
  onColorChange: (color: AgentColor) => void;
  /** A built-in agent ships in code — its glyph is a fact, not a field. */
  readOnly?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (readOnly) return <AgentGlyph icon={icon} color={color} size="lg" />;
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      className="w-56"
      trigger={
        <button
          type="button"
          aria-label={`${label}: change icon and color`}
          className="slip slip-press flex cursor-pointer rounded-r3 border border-transparent p-0.5 hover:border-s5 active:scale-[0.97]"
        >
          <AgentGlyph icon={icon} color={color} size="lg" />
        </button>
      }
    >
      <div className="flex flex-col gap-3 px-3 py-3">
        <div role="group" aria-label="Icon" className="flex flex-col gap-1.5">
          <CapsLabel className="px-0 pt-0 pb-0.5">Icon</CapsLabel>
          <div className="grid grid-cols-8 gap-1">
            {AGENT_ICON_NAMES.map((name) => {
              const Glyph = AGENT_GLYPHS[name];
              return (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  aria-pressed={name === icon}
                  onClick={() => onIconChange(name)}
                  className={cx(
                    'slip slip-press flex h-6 w-6 cursor-pointer items-center justify-center rounded-r2 active:scale-[0.95]',
                    name === icon ? 'bg-s4 text-s12' : 'text-s8 hover:bg-s3 hover:text-s11',
                  )}
                >
                  <Glyph aria-hidden size={14} />
                </button>
              );
            })}
          </div>
        </div>
        <div role="group" aria-label="Color" className="flex flex-col gap-1.5">
          <CapsLabel className="px-0 pt-0 pb-0.5">Color</CapsLabel>
          <div className="flex gap-1.5">
            {AGENT_COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={name === color}
                onClick={() => onColorChange(name)}
                className={cx(
                  'slip h-5 w-5 cursor-pointer rounded-full hover:scale-110 active:scale-95',
                  AGENT_SOLID[name],
                  name === color && 'ring-2 ring-s11 ring-offset-2 ring-offset-s3',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </PopoverCard>
  );
}

/** Click-to-edit text (the Linear/Notion title pattern): a quiet display button with a
 *  hover pencil; click swaps in a field. Enter OR clicking away commits, Escape cancels
 *  without committing; an empty or unchanged draft reverts silently. */
/** ONE metric worn by BOTH faces of the name: same size, weight, line-height, padding
 *  and border box, so clicking into the field moves nothing. The display face just wears
 *  a transparent border and no ground.
 *
 *  Both faces used to carry `text-body`, which resolves only in the RETIRED kit's type
 *  ramp (console-ui, 16px) — the current ramp is body/sec/code/meta/caps/icon and has no
 *  such step. So the display face reached across into the old kit for its size, while the
 *  edit face could not override the shared input skin at all and rendered mono at code
 *  size. Two ramps, two families, two heights, for one value. */
const NAME_FACE =
  'w-fit min-w-0 rounded-r2 border px-1.5 py-0.5 text-body leading-5 font-semibold text-s12';

function InlineEditName({
  value,
  label,
  onCommit,
  readOnly = false,
}: {
  value: string;
  label: string;
  onCommit: (next: string) => void;
  /** A built-in agent ships in code — its name is a fact, not a field. */
  readOnly?: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Guards exactly ONE exit per edit session. Enter, blur, and Escape all route
  // through commit/cancel below, and unmounting a still-focused input can itself
  // raise a blur — without this an Enter-commit would fire a second time (its own
  // unmount's blur) rather than a `!editing` early-return, since the field is gone.
  const settledRef = useRef(false);

  const commit = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    if (next !== '' && next !== value) onCommit(next);
    setEditing(false);
  };
  const cancel = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    setEditing(false);
  };

  if (readOnly) {
    return <span className={cx(NAME_FACE, 'border-transparent')}>{value}</span>;
  }

  if (editing) {
    return (
      <TextInput
        autoFocus
        value={draft}
        onChange={setDraft}
        aria-label={label}
        placeholder={label}
        onCommit={commit}
        onBlur={commit}
        onCancel={cancel}
        // `skin`, not `className`: the shared input skin is mono at code size, and
        // appending cannot beat it on font-family. Swapping the whole skin is what keeps
        // the two faces identical.
        skin={cx(NAME_FACE, 'slip border-s5 bg-s1 outline-none focus:border-s7')}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Rename ${label}: ${value}`}
      onClick={() => {
        settledRef.current = false;
        setDraft(value);
        setEditing(true);
      }}
      className={cx(
        NAME_FACE,
        'slip group -mx-1.5 inline-flex cursor-pointer items-center gap-2 border-transparent text-left hover:bg-s2',
      )}
    >
      <span className="truncate">{value}</span>
      <span className="flex-none text-s7 opacity-0 group-hover:opacity-100">
        <Icon name="edit" size="sm" />
      </span>
    </button>
  );
}

/** The description's display/edit face — secondary prose, not the bold name face
 *  (`NAME_FACE`); same click-to-edit contract as `InlineEditName` otherwise. */
const DESCRIPTION_FACE = 'w-full min-w-0 rounded-r2 border px-1.5 py-0.5 text-sec leading-5 text-s9';

/** What a parent agent reads to choose between agents (SPEC CON-1) — the one field
 *  this whole change exists to add a UI for. Click-to-edit like `InlineEditName`,
 *  styled as secondary prose. The schema requires it non-empty (`min(1)`); an
 *  emptied draft reverts to the last good value on commit rather than sending a
 *  write the daemon would refuse — the same "degrade, don't throw an opaque RPC
 *  error" posture `InlineEditName` already takes for an emptied name. */
function DescriptionField({
  value,
  onCommit,
  readOnly = false,
}: {
  value: string;
  onCommit: (next: string) => void;
  /** A built-in agent ships in code — its description is a fact, not a field. */
  readOnly?: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const settledRef = useRef(false);

  const commit = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    if (next !== '' && next !== value) onCommit(next);
    setEditing(false);
  };
  const cancel = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    setEditing(false);
  };

  if (readOnly) {
    return <p className={cx(DESCRIPTION_FACE, 'border-transparent px-0')}>{value}</p>;
  }

  if (editing) {
    return (
      <TextInput
        autoFocus
        value={draft}
        onChange={setDraft}
        aria-label="Agent description"
        placeholder="What this agent is for."
        onCommit={commit}
        onBlur={commit}
        onCancel={cancel}
        skin={cx(DESCRIPTION_FACE, 'slip border-s5 bg-s1 outline-none focus:border-s7')}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Edit agent description: ${value}`}
      onClick={() => {
        settledRef.current = false;
        setDraft(value);
        setEditing(true);
      }}
      className={cx(
        DESCRIPTION_FACE,
        'slip group -mx-1.5 flex w-[calc(100%+0.75rem)] cursor-pointer items-start gap-2 border-transparent text-left hover:bg-s2',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <span className="flex-none pt-0.5 text-s7 opacity-0 group-hover:opacity-100">
        <Icon name="edit" size="sm" />
      </span>
    </button>
  );
}

/** A quiet fact pill — the scope and pinned markers beside the identity. */
function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'info';
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cx(
        'rounded-r1 border px-1.5 py-0.5 font-mono text-meta',
        tone === 'info' ? 'border-s6 bg-s5 text-s12' : 'border-s5 text-s8',
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------ the list ------------------------------------ */

/** Below this the detail pane has no room to be a pane, so the surface becomes a drill-down. */
const AGENTS_NARROW_PX = 640;

function AgentList({
  vm,
  query,
  narrow,
  onSelect,
}: {
  vm: Extract<AgentsVm, { status: 'ready' }>;
  query: string;
  narrow: boolean;
  onSelect: (ref: string) => void;
}): React.JSX.Element {
  const setQuery = useAgentsUi((s) => s.setQuery);
  const filterFocus = useAgentsUi((s) => s.filterFocus);
  const filterRef = useRef<HTMLInputElement>(null);
  const filtered = vm.agents.filter((a) => matchesAgent(a, query, vm.roles));
  const isPinned = (a: AgentSummary): boolean => vm.pinned.includes(a.ref);
  const pinned = filtered.filter(isPinned);
  // Built-in agents ship in code — every project has them, so they read as the fixed
  // baseline, listed right after whatever the user pinned. Without their own group
  // they matched neither `project` nor `personal` and rendered nowhere at all.
  const builtin = filtered.filter((a) => a.scope === 'builtin' && !isPinned(a));
  const project = filtered.filter((a) => a.scope === 'project' && !isPinned(a));
  const personal = filtered.filter((a) => a.scope === 'personal' && !isPinned(a));

  // ctrl+f bumps the nonce (keys.tsx's `filter-agents` command) — every bump takes the
  // caret to the filter, whether or not it moved since the last one. The field moved out
  // of the title bar and onto the list it filters, so the effect moved with it.
  useEffect(() => {
    if (filterFocus > 0) filterRef.current?.focus();
  }, [filterFocus]);

  return (
    // The canvas ground (s1), not the nav's (s2) — same convention as auth's list column:
    // this belongs to the surface, not to the app frame.
    <div
      className={cx(
        'flex min-h-0 flex-col',
        narrow ? 'min-w-0 flex-1' : 'w-64 flex-none border-r border-s3',
      )}
    >
      {/* The filter belongs to the list, not to the app chrome. Full-bleed over the
          column when there IS a column; centered and capped when the list has taken the
          whole pane, so it never stretches into a banner. */}
      <div className={cx('border-b border-s3 px-5 pt-3 pb-2.5', narrow && 'flex justify-center')}>
        <div className={cx('relative w-full', narrow && 'max-w-80')}>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 font-mono text-code text-s7"
          >
            ⌕
          </span>
          <input
            ref={filterRef}
            type="search"
            role="searchbox"
            aria-label="Filter agents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter agents…"
            className={cx(TEXT_INPUT_CLASS, 'w-full pl-6')}
            style={NO_DRAG}
          />
        </div>
      </div>
      <div
        role="list"
        aria-label="Agents"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-6"
      >
        {filtered.length === 0 ? (
          <SurfaceEmpty title="No matches" hint="try a different filter" />
        ) : (
          <>
            {pinned.length > 0 && (
              // `group`: a `CapsLabel` header is not a `listitem`, so it can't sit as
              // the list's direct child alongside the rows — grouping it with the rows
              // it names keeps `role="list"` holding only `group`/`listitem` children.
              <div role="group" aria-label="Pinned agents">
                <CapsLabel className="px-0 pb-1.5">Pinned agents</CapsLabel>
                {pinned.map((a) => (
                  <AgentRow
                    key={a.ref}
                    agent={a}
                    selected={a.ref === vm.selected.ref}
                    narrow={narrow}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
            {builtin.length > 0 && (
              <div role="group" aria-label="Built-in agents">
                <CapsLabel className={cx('px-0 pb-1.5', pinned.length > 0 && 'pt-5')}>
                  Built-in agents
                </CapsLabel>
                {builtin.map((a) => (
                  <AgentRow
                    key={a.ref}
                    agent={a}
                    selected={a.ref === vm.selected.ref}
                    narrow={narrow}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
            {project.length > 0 && (
              <div role="group" aria-label="Project agents">
                <CapsLabel
                  className={cx('px-0 pb-1.5', (pinned.length > 0 || builtin.length > 0) && 'pt-5')}
                >
                  Project agents
                </CapsLabel>
                {project.map((a) => (
                  <AgentRow
                    key={a.ref}
                    agent={a}
                    selected={a.ref === vm.selected.ref}
                    narrow={narrow}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
            {personal.length > 0 && (
              <div role="group" aria-label="Personal agents">
                <CapsLabel
                  className={cx(
                    'px-0 pb-1.5',
                    (pinned.length > 0 || builtin.length > 0 || project.length > 0) && 'pt-5',
                  )}
                >
                  Personal agents
                </CapsLabel>
                {personal.map((a) => (
                  <AgentRow
                    key={a.ref}
                    agent={a}
                    selected={a.ref === vm.selected.ref}
                    narrow={narrow}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  selected,
  narrow,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  narrow: boolean;
  onSelect: (ref: string) => void;
}): React.JSX.Element {
  return (
    // The whole row is the hit target (the stretched-link pattern), matching auth's
    // rows. Name + model render the SAME way whether or not the row is selected —
    // typography doesn't take a dependency on selection state.
    <div
      role="listitem"
      className={cx(
        'slip group relative -mx-3 flex items-center gap-2.5 rounded-r3 px-3 py-2 text-sec',
        selected ? 'bg-s3 text-s12' : 'text-s10 hover:bg-s2 hover:text-s11',
      )}
    >
      <button
        type="button"
        aria-label={agent.name}
        onClick={() => onSelect(agent.ref)}
        className="absolute inset-0 cursor-pointer rounded-r3"
      />
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5">
        <AgentGlyph icon={agent.icon} color={agent.color} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{agent.name}</span>
          {agent.model !== undefined && (
            <span className="block truncate font-mono text-meta text-s7">{agent.model}</span>
          )}
        </span>
      </span>
      {narrow && <span className="relative font-mono text-meta text-s7">›</span>}
    </div>
  );
}

/* ----------------------------------- the detail ----------------------------------- */

/** Which model, which harness, how hard it thinks. The harness mark plus the model name
 *  identify the field (the picker's accessible name still says "Model" for anyone not
 *  reading the glyph). The harness itself is derived, never chosen, so it renders as a
 *  statement with a tooltip rather than a control — and sits OUTSIDE the trigger, so it
 *  never looks pickable. Everything else is `ModelPicker`, shared with the composer. */
function RunsOnField({
  agent,
  models,
  onChange,
  readOnly = false,
}: {
  agent: AgentSummary;
  models: ModelDescriptor[];
  onChange: (patch: Partial<Omit<AgentSummary, 'ref'>>) => void;
  /** A built-in agent ships in code — its model is a fact, not a field. */
  readOnly?: boolean;
}): React.JSX.Element {
  const selectedModel = models.find((m) => m.id === agent.model);
  const harness = harnessOf(selectedModel?.provider ?? agent.provider);
  const mark = harness === 'claude-code' ? CLAUDE_MARK : COA_MARK;
  const reasoningOptions = effortOptions(selectedModel);
  const reasoningVal = reasoningValue(clampReasoning(agent.reasoning, selectedModel));

  if (readOnly) {
    return (
      <div className="flex items-center gap-2">
        <Tooltip label={harnessBlurb(harness)} side="top">
          <span tabIndex={0} className="slip flex flex-none rounded-r1">
            <BrandMark spec={mark} size={16} />
          </span>
        </Tooltip>
        <span className="text-code text-s9">
          {selectedModel?.displayName ?? agent.model ?? 'Default model'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <Tooltip label={harnessBlurb(harness)} side="top">
        <span tabIndex={0} className="slip mt-0.5 flex flex-none rounded-r1">
          <BrandMark spec={mark} size={16} />
        </span>
      </Tooltip>
      <ModelPicker
        variant="bordered"
        models={models}
        value={agent.model}
        effortOptions={reasoningOptions}
        effortValue={reasoningVal}
        onEffortChange={(v) => onChange({ reasoning: toReasoning(v) })}
        onChange={(model) => {
          // The chosen model carries its provider (the list is merged across backends);
          // store it so the session routes there. Keep the reasoning valid for the new
          // model (an effort/stop it doesn't offer falls back to the ladder's first).
          const picked = models.find((m) => m.id === model);
          const clamped = clampReasoning(agent.reasoning, picked);
          onChange({
            model,
            ...(picked?.provider !== undefined ? { provider: picked.provider } : {}),
            ...(clamped !== agent.reasoning ? { reasoning: clamped } : {}),
          });
        }}
      />
    </div>
  );
}

/** The resolved-set row list fills the width it is given: on a wide pane a long package
 *  list reads as columns instead of one stranded line each, which is the whole point of
 *  giving the editor the pane. `auto-fit` collapses to a single column with no
 *  breakpoint, so the narrow drill-down needs no special case. */
const ROW_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-0.5';

/** `membershipSource` hands back a role's name (already capitalised) or the
 *  sentinel `'default'` — data, not copy. Every visible meta string in the app
 *  starts with a capital letter, so the sentinel earns one here, at the point of
 *  render, rather than by editing what the resolver returns. */
function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** The roles a role brings — the same fact the resolved-set header reports via a
 *  package's `meta`, worded for a role row: how many packages selecting it adds. */
function roleMeta(role: RoleSummary): string {
  const n = role.packageIds.length;
  return `${n} ${n === 1 ? 'package' : 'packages'}`;
}

/** Only the roles the agent actually runs as, each a `SetRow` naming what it
 *  brings; the full catalogue lives behind the `AddPicker` alone, so an unselected
 *  role never crowds this list the way the old flat checklist did. */
function RolesSection({
  agent,
  roles,
  onChange,
  readOnly = false,
}: {
  agent: AgentSummary;
  roles: RoleSummary[];
  onChange: (patch: Partial<Omit<AgentSummary, 'ref'>>) => void;
  /** A built-in agent ships in code — its roles are a fact, not a set to edit. */
  readOnly?: boolean;
}): React.JSX.Element {
  const selectedIds = agent.roles ?? [];
  const selected = roles.filter((r) => selectedIds.includes(r.id));

  const toggle = (id: string): void => {
    if (readOnly) return;
    onChange({
      roles: selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    });
  };

  return (
    <Panel
      label="Roles"
      count={selected.length}
      footer={
        readOnly ? undefined : (
          <AddPicker
            label="Add Role"
            placeholder="Filter roles…"
            items={roles.map((r) => ({
              id: r.id,
              name: r.name,
              membership: selectedIds.includes(r.id) ? 'added' : 'available',
              ...(r.description !== '' ? { description: r.description } : {}),
            }))}
            onToggle={toggle}
          />
        )
      }
    >
      <div data-row-grid className={ROW_GRID}>
        {selected.map((r) => (
          <SetRow
            key={r.id}
            name={r.name}
            {...(r.description !== '' ? { description: r.description } : {})}
            membership="added"
            meta={roleMeta(r)}
            onToggle={() => toggle(r.id)}
          />
        ))}
      </div>
    </Panel>
  );
}

/** The rank a row's membership sorts by: what a default or a selected role brings
 *  in reads first (it needed no decision from the user), the user's own opt-ins
 *  next, and an active exclusion last — still visible, but at the bottom, since it
 *  is a deliberate "no" rather than part of what is currently running. */
const MEMBERSHIP_RANK: Record<Membership, number> = {
  inherited: 0,
  added: 1,
  excluded: 2,
  available: 3,
};

/** The resolved set ONLY — an "available" package (nothing brings it, the user
 *  never opted in) has no home here; it lives behind the `AddPicker`. An
 *  "excluded" package is the one deliberate exception: a past default or
 *  role-supplied package the user turned off stays visible in the agent's own
 *  list (SC-1's "help, never cage" for the agent's own history), ordered last so
 *  what is running still reads first. */
function ContextSection({
  agent,
  packages,
  roles,
  onChange,
  readOnly = false,
}: {
  agent: AgentSummary;
  packages: PackageSummary[];
  roles: RoleSummary[];
  onChange: (patch: Partial<Omit<AgentSummary, 'ref'>>) => void;
  /** A built-in agent ships in code — its context is a fact, not a set to edit. */
  readOnly?: boolean;
}): React.JSX.Element {
  const included = includedPackageIds(packages, roles, agent);
  const excludedIds = (agent.exclude ?? []).filter((id) => !included.has(id));
  const advisories = packageAdvisories(packages, included);

  const rows = [...included, ...excludedIds]
    .map((id) => ({
      id,
      pkg: packages.find((p) => p.id === id),
      membership: packageMembership(packages, roles, agent, id),
    }))
    .sort((x, y) => MEMBERSHIP_RANK[x.membership] - MEMBERSHIP_RANK[y.membership]);

  const toggle = (id: string): void => {
    if (readOnly) return;
    onChange(togglePackage(packages, roles, agent, id));
  };

  return (
    <Panel
      label="Context"
      count={included.size}
      footer={
        readOnly ? undefined : (
          <AddPicker
            label="Add Context"
            placeholder="Filter packages…"
            items={packages.map((p) => ({
              id: p.id,
              name: p.name,
              membership: packageMembership(packages, roles, agent, p.id),
              ...(p.description !== '' ? { description: p.description } : {}),
            }))}
            onToggle={toggle}
          />
        )
      }
    >
      <div data-row-grid className={ROW_GRID}>
        {rows.map(({ id, pkg, membership }) => {
          const source = membershipSource(packages, roles, id);
          return (
            <SetRow
              key={id}
              name={pkg?.name ?? id}
              {...(pkg?.description !== undefined && pkg.description !== ''
                ? { description: pkg.description }
                : {})}
              membership={membership}
              {...(source !== undefined ? { meta: capitalize(source) } : {})}
              onToggle={() => toggle(id)}
            />
          );
        })}
      </div>
      {advisories.length > 0 && (
        <div className="px-1 pt-2">
          <InlineMessage tone="info">
            Recommended: {advisories.map((p) => p.name).join(', ')}
          </InlineMessage>
        </div>
      )}
    </Panel>
  );
}

/** The declared reach: the deduped union of tool and MCP grants the agent's INCLUDED
 *  packages actually add up to (`reachOf`, mirroring `assembleAgent`'s own union) —
 *  what this composition can reach, not a decorative summary. Read-only: nothing
 *  here is a control, so it carries no membership state, only the derived fact.
 *
 *  With no roles selected, `createRegistryAssemblePieces`
 *  (packages/core/src/session/assemble-agent.ts) never reaches the package union at
 *  all — it returns the permissive floor, `{allow: [], deny: []}` (D85 pass-through:
 *  every backend tool stays available). Enumerating the default packages' toolRefs
 *  in that state would understate reach and imply a restriction that isn't real, so
 *  the band branches on role selection rather than on the union alone: with no roles
 *  it states the permissive floor in words and renders no count at all; with one or
 *  more roles it enumerates the union as usual. Per the indicator law a count that
 *  would mislead does not render, so the header count is suppressed both when no
 *  roles are selected AND when the (real, role-scoped) union is empty; the closing
 *  line names the harness this declaration is realized on either way.
 *
 *  The header count is also tools-only, never "· N MCP": `reachOf`'s mcp union is
 *  real (it mirrors `assembleAgent`'s own `mcpServers`), but
 *  `createRegistryAssemblePieces` (packages/core/src/session/assemble-agent.ts)
 *  currently drops `mcpServers` on the floor — no adapter is ever handed the grant.
 *  Rendering the count today would always read `· 0 MCP`, which the indicator law
 *  above already forbids. `mcp` still feeds `isEmpty` below, since an MCP-only
 *  package should not read as "reaches nothing" even though its grant isn't wired
 *  up yet; only the visible count is withheld. */
function ReachSection({
  agent,
  models,
  packages,
  roles,
}: {
  agent: AgentSummary;
  models: ModelDescriptor[];
  packages: PackageSummary[];
  roles: RoleSummary[];
}): React.JSX.Element {
  const included = includedPackageIds(packages, roles, agent);
  const { tools, mcp } = reachOf(packages, included);
  const permissive = roles.length === 0;
  const isEmpty = tools.length === 0 && mcp.length === 0;
  const selectedModel = models.find((m) => m.id === agent.model);
  const harness = harnessOf(selectedModel?.provider ?? agent.provider);

  return (
    <Panel
      label="Reach"
      density="prose"
      count={
        !permissive && !isEmpty
          ? `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`
          : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {permissive ? (
          <p className="text-code text-s7">This agent reaches every tool the backend offers.</p>
        ) : isEmpty ? (
          <p className="text-code text-s7">This agent reaches nothing yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((name) => (
              // The well treatment (s1 inside the panel's s2), same family as the usage
              // surface's chips — a darker inset, not the local scope Pill's outline.
              <span
                key={name}
                className="rounded-r1 border border-s5 bg-s1 px-1.5 py-0.5 font-mono text-meta text-s9"
              >
                {name}
              </span>
            ))}
          </div>
        )}
        <p className="text-code text-s7">Realized on {harnessLabel(harness)}.</p>
        {/* The consequence panel is where "when does this take effect" belongs — it is a
            fact about the whole declaration, not about any one section above it. */}
        <p className="text-code text-s7">
          The roles, model, and package selection take effect on the next message. Packages apply
          once one or more roles are selected (with no roles the agent runs the permissive
          baseline).
        </p>
      </div>
    </Panel>
  );
}

/** The identity header + overflow, the "runs on" cluster (model/harness/reasoning), and the
 *  role/context editor: only what is in the agent, each row stating how it got there, with
 *  the full catalogue moved into a searchable `AddPicker` per section. The danger path
 *  confirms in a ModalShell — project agents are shared via git, so their delete types the
 *  name. */
function AgentEditor({ vm }: { vm: Extract<AgentsVm, { status: 'ready' }> }): React.JSX.Element {
  const a = vm.selected;
  // A built-in agent ships in code (no file backs it) — the daemon refuses a
  // save/delete against it, so the editor renders it read-only rather than
  // offering controls that would silently do nothing.
  const readOnly = a.scope === 'builtin';
  const selectedRoles = vm.roles.filter((r) => (a.roles ?? []).includes(r.id));
  const pinned = vm.pinned.includes(a.ref);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState('');
  const deleteBlocked = a.scope === 'project' && deleteDraft !== a.name;

  const closeDelete = (): void => {
    setConfirmingDelete(false);
    setDeleteDraft('');
  };

  return (
    // A query CONTAINER, not a measured pane: the columns below answer to the editor's own
    // content box. Keying them off the surface width (which includes the 16rem list) let the
    // editor keep two columns at widths where it only had room for one, so the right column
    // clipped instead of collapsing.
    <div className="@container min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-7">
      {/* ONE measure. The header, its rule and the grid below all resolve to the same
          width — the previous 640px header over 448px content put the rule that
          introduces the content wider than the content itself. */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-start gap-3">
          <IdentityPicker
            icon={a.icon}
            color={a.color}
            label={a.name}
            onIconChange={(icon) => vm.updateAgent(a.ref, { icon })}
            onColorChange={(color) => vm.updateAgent(a.ref, { color })}
            readOnly={readOnly}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
            <InlineEditName
              value={a.name}
              label="Agent name"
              onCommit={(name) => vm.updateAgent(a.ref, { name })}
              readOnly={readOnly}
            />
            <div className="flex items-center gap-2">
              <Pill>
                {a.scope === 'builtin' ? 'Built-in' : a.scope === 'project' ? 'Project' : 'Personal'}
              </Pill>
              <span className="font-mono text-meta text-s7">{a.ref}</span>
            </div>
            <DescriptionField
              value={a.description}
              onCommit={(description) => vm.updateAgent(a.ref, { description })}
              readOnly={readOnly}
            />
          </div>
          {/* The pin is the indicator AND the control that changes it. That's legal where
              a bare indicator wouldn't be: a control may render while it is off, so the
              unpinned state still has something to click. Pin/Unpin stays in the menu as
              the discoverable path. */}
          <div className="flex flex-none items-center gap-0.5">
            <Tooltip label={pinned ? 'Unpin agent' : 'Pin agent'} side="top">
              <button
                type="button"
                aria-label={pinned ? 'Unpin agent' : 'Pin agent'}
                aria-pressed={pinned}
                onClick={() => vm.togglePinAgent(a.ref)}
                className={cx(
                  'slip slip-press flex h-6 w-6 cursor-pointer items-center justify-center rounded-r2 hover:bg-s4 active:scale-[0.95]',
                  pinned ? 'text-s11 hover:text-s12' : 'text-s7 hover:text-s11',
                )}
              >
                <Icon name={pinned ? 'pin-off' : 'pin'} size="sm" />
              </button>
            </Tooltip>
            <RowMenu label="Agent actions">
              <MenuItem onClick={() => vm.togglePinAgent(a.ref)}>
                {pinned ? 'Unpin' : 'Pin'}
              </MenuItem>
              {/* Duplicating a built-in has nowhere to write TO except a real scope —
                  it seeds a project agent rather than trying to "duplicate" a definition
                  that has no file of its own. */}
              <MenuItem onClick={() => vm.createAgent(a.scope === 'builtin' ? 'project' : a.scope)}>
                Duplicate
              </MenuItem>
              {/* A built-in has no file to move — the menu offers only what the daemon
                  can actually do. */}
              {!readOnly && (
                <MenuItem
                  onClick={() =>
                    vm.updateAgent(a.ref, { scope: a.scope === 'project' ? 'personal' : 'project' })
                  }
                >
                  {a.scope === 'project' ? 'Move to Personal' : 'Move to Project'}
                </MenuItem>
              )}
              {!readOnly && (
                <MenuItem
                  onClick={() => {
                    setDeleteDraft('');
                    setConfirmingDelete(true);
                  }}
                >
                  <span className="text-crit">Delete…</span>
                </MenuItem>
              )}
            </RowMenu>
          </div>
        </div>

        <div className="border-t border-s3" />

        {/* Runtime and its consequence on a left rail; the composition you actually
            manipulate takes the wide column. The column gutter is deliberately WIDER
            than the gap between stacked panels — an even value everywhere collapses the
            grid into one undifferentiated mesh instead of reading as two columns.
            ONE COLUMN is the floor, not the exception: below 576px of content box the
            two columns cannot both hold their contents (16.5rem rail + 1.5rem gutter +
            the 17rem a resolved-set row needs), so DOM order — Runs on · Roles · Context
            · Reach — is authored to read correctly stacked, and the explicit placement
            that lifts Reach onto the rail only applies once there is room for it. */}
        <div className="grid grid-cols-1 gap-y-3.5 @min-[576px]:grid-cols-[16.5rem_minmax(0,1fr)] @min-[576px]:gap-x-6">
          <div className="flex flex-col gap-3.5 @min-[576px]:col-start-1 @min-[576px]:row-start-1">
            <Panel label="Runs on" density="prose">
              <RunsOnField
                agent={a}
                models={vm.models}
                onChange={(patch) => vm.updateAgent(a.ref, patch)}
                readOnly={readOnly}
              />
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-3.5 @min-[576px]:col-start-2 @min-[576px]:row-span-2 @min-[576px]:row-start-1">
            {vm.roles.length > 0 && (
              <RolesSection
                agent={a}
                roles={vm.roles}
                onChange={(patch) => vm.updateAgent(a.ref, patch)}
                readOnly={readOnly}
              />
            )}

            {vm.packages.length > 0 && (
              <ContextSection
                agent={a}
                packages={vm.packages}
                roles={selectedRoles}
                onChange={(patch) => vm.updateAgent(a.ref, patch)}
                readOnly={readOnly}
              />
            )}
          </div>

          {vm.packages.length > 0 && (
            <div className="flex flex-col gap-3.5 @min-[576px]:col-start-1 @min-[576px]:row-start-2">
              <ReachSection
                agent={a}
                models={vm.models}
                packages={vm.packages}
                roles={selectedRoles}
              />
            </div>
          )}
        </div>
      </div>

      <ModalShell
        open={confirmingDelete}
        onClose={closeDelete}
        aria-label="Delete Agent"
        className="w-96"
      >
        <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
          <span className="text-sec font-semibold text-s11">Delete {a.name}?</span>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 text-code leading-relaxed text-s9">
          <span>
            {a.scope === 'project'
              ? 'This agent is committed in .coa/ and shared with collaborators. Type its name to confirm.'
              : 'This personal agent and its local configuration will be removed.'}
          </span>
          {a.scope === 'project' && (
            <TextInput
              value={deleteDraft}
              onChange={setDeleteDraft}
              placeholder={a.name}
              aria-label="Agent name"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
          <Button variant="outline" onClick={closeDelete}>
            Cancel
          </Button>
          <Button
            variant="quiet"
            disabled={deleteBlocked}
            onClick={() => {
              closeDelete();
              vm.deleteAgent(a.ref);
            }}
          >
            <span className="text-crit">Delete Agent</span>
          </Button>
        </div>
      </ModalShell>
    </div>
  );
}

/* ------------------------------- the title-bar strip ------------------------------- */

/** The title bar IS the surface's chrome: the surface's name and, on a narrow pane, the
 *  drill-down's way back (the same place auth and usage keep theirs) — plus the create
 *  control, which acts on the WHOLE surface rather than on the list, and so stays
 *  reachable even from inside the drill-down. The FILTER is not here: it belongs to the
 *  list it filters, and lives at the head of that column. */
export function AgentsStrip(): React.JSX.Element {
  const state = useConsoleState((s) => s);
  const narrow = useAgentsUi((s) => s.narrow);
  const open = useAgentsUi((s) => s.open);
  const setOpen = useAgentsUi((s) => s.setOpen);
  const agents = state?.data.agents.status === 'ok' ? state.data.agents.value : [];
  const selectedRef = state?.ui.selectedAgentRef;
  const drilled = narrow && open ? agents.find((a) => a.ref === selectedRef) : undefined;

  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5 px-4" style={NO_DRAG}>
        {drilled === undefined ? (
          <>
            <span className="font-mono text-meta tracking-[0.06em] text-s9">Agents</span>
            {agents.length > 0 && (
              <span className="font-mono text-meta text-s7">{agents.length} agents</span>
            )}
          </>
        ) : (
          <>
            <Button variant="text" onClick={() => setOpen(false)}>
              ‹ agents
            </Button>
            <span className="truncate text-sec font-[550] text-s12">{drilled.name}</span>
          </>
        )}
      </div>
      <div className="flex-1" />
      {/* Creating an agent acts on the surface, not on the list, so it stays reachable
          from inside the drill-down too (where it used to unmount). The strip is
          `items-stretch`, so this wrapper spans the full title-bar height and has to
          center its own child — otherwise the control sits on the top edge. */}
      <div className="flex items-center" style={NO_DRAG}>
        <Button
          variant="text"
          className="mr-3"
          onClick={() => state?.actions.createAgent('project')}
        >
          + New Agent
        </Button>
      </div>
    </>
  );
}

/* ---------------------------------- the surface ---------------------------------- */

function ReadyAgents({
  vm,
  query,
  narrow,
  open,
  setOpen,
}: {
  vm: Extract<AgentsVm, { status: 'ready' }>;
  query: string;
  narrow: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}): React.JSX.Element {
  const select = (ref: string): void => {
    vm.selectAgent(ref);
    if (narrow) setOpen(true);
  };

  if (narrow) {
    // The drill-down: one pane at a time, swapped with the SAME cross-fade the wide
    // detail uses — the surface is re-pointed, not replaced.
    return (
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {!open ? (
            <motion.div key="list" className="absolute inset-0 flex flex-col" {...RISE}>
              <AgentList vm={vm} query={query} narrow onSelect={select} />
            </motion.div>
          ) : (
            <motion.div
              key={`detail-${vm.selected.ref}`}
              className="absolute inset-0 flex flex-col"
              {...RISE}
            >
              {/* The way back lives in the title-bar strip — the canvas is all detail. */}
              <AgentEditor vm={vm} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <AgentList vm={vm} query={query} narrow={false} onSelect={select} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The detail cross-fades between agents — one surface being re-pointed, not a
            page being replaced (concurrent, no `mode="wait"`). */}
        <div className="relative min-h-0 flex-1">
          <AnimatePresence initial={false}>
            <motion.div key={vm.selected.ref} className="absolute inset-0 flex flex-col" {...RISE}>
              <AgentEditor vm={vm} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** One load problem the daemon's registry reported (a duplicate ref, an invalid
 *  file, a file that tries to name its own ref) — reported, never swallowed, so a
 *  user with a broken agent file can find out why it's missing instead of it just
 *  not showing up. Kept to one line per problem (the affected ref/scope + a short
 *  reason) rather than becoming its own diagnostics view. */
function diagnosticReason(problem: AgentDiagnostic['problem']): string {
  switch (problem) {
    case 'duplicate-ref':
      return 'duplicate ref';
    case 'invalid':
      return 'invalid file';
    case 'ref-in-file':
      return 'ref field ignored';
  }
}

function AgentDiagnosticsBanner({
  diagnostics,
}: {
  diagnostics: AgentDiagnostic[];
}): React.JSX.Element | null {
  if (diagnostics.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-s3 px-5 py-2.5">
      {diagnostics.map((d) => (
        <InlineMessage key={`${d.scope}/${d.ref}/${d.problem}`} tone="warning" className="text-code">
          <span className="font-mono">{d.ref}</span> ({d.scope}) — {diagnosticReason(d.problem)}:{' '}
          {d.detail}
        </InlineMessage>
      ))}
    </div>
  );
}

/** State-fed surface: computes the vm from console state and renders the master–detail
 *  agents editor. Master–detail at width; the SAME two components stack into a
 *  drill-down when the pane is narrow (the auth-surface pattern). */
export function AgentsSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  const vm = selectAgentsVm(state);
  const query = useAgentsUi((s) => s.query);
  const narrow = useAgentsUi((s) => s.narrow);
  const setNarrowUi = useAgentsUi((s) => s.setNarrow);
  const open = useAgentsUi((s) => s.open);
  const setOpen = useAgentsUi((s) => s.setOpen);
  const hostRef = useRef<HTMLDivElement>(null);
  const measured = useNarrow(hostRef, AGENTS_NARROW_PX);

  // Becoming narrow always lands on the LIST: an agent open while both panes were
  // visible must not reopen as a drill-down you never chose to enter.
  useEffect(() => {
    setNarrowUi(measured);
    if (measured) setOpen(false);
  }, [measured, setNarrowUi, setOpen]);

  // Esc climbs out of the drill-down. Registered on the kit's dismiss-layer stack, so a
  // menu or modal open above it still wins its own Escape first.
  useDismissLayer(narrow && open, () => setOpen(false));

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col">
      <AgentDiagnosticsBanner diagnostics={state.data.agentDiagnostics} />
      {vm.status === 'loading' && <SkeletonLines widths={['w-40', 'w-64', 'w-52']} />}
      {vm.status === 'error' && <SurfaceError message={vm.message} />}
      {vm.status === 'empty' && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
          <SurfaceEmpty
            title="No agents yet"
            hint="create an agent to configure how the loop works in this project"
          />
          <Button variant="quiet" onClick={() => vm.createAgent('project')}>
            New Agent
          </Button>
        </div>
      )}
      {vm.status === 'ready' && (
        <ReadyAgents vm={vm} query={query} narrow={narrow} open={open} setOpen={setOpen} />
      )}
    </div>
  );
}
