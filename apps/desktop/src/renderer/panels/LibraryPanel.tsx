import { useEffect, useState } from 'react';
import type {
  DiscoveredMcpServer,
  DiscoveredSkill,
  LibraryDiagnostic,
  LibraryEntryView,
  LibraryView,
  McpLayer,
  McpServerEntry,
  SkillOrigin,
} from '@coa/console-viewmodel';
import {
  Button,
  CapsLabel,
  Icon,
  InlineMessage,
  MenuItem,
  PopoverCard,
  StatusDot,
  Toggle,
  Tooltip,
  cx,
} from '@coa/console-kit';
import { NO_DRAG } from '../shell/appRegion.js';
import { useLibraryStore, type LibraryState } from './libraryStore.js';
import { LIBRARY_TABS, LIBRARY_TAB_LABEL, useLibraryUi, type LibraryTab } from './libraryUi.js';
import { RowMenu } from './RowMenu.js';
import { SkeletonLines, SurfaceError } from './surfaceStates.js';
import { Segmented } from './UsagePanel.js';

/**
 * The Library surface — skills and MCP servers as first-class, managed citizens.
 * It renders EXACTLY what the daemon's `listLibrary` returns (the declarative
 * stores are the source of truth; drift and shadowing are computed daemon-side,
 * never re-derived here): one tab per kind, and per tab the two stores (Personal /
 * Project) plus everything Discovered on disk that no store has claimed yet.
 * MCP management is config + status surfacing only — the rows state transport and
 * source and whether the entry resolves; there is no invented health probe.
 */

/* --------------------------------- vocabulary --------------------------------- */

/** Where a discovered skill was found, in surface words. */
export const ORIGIN_LABEL: Record<SkillOrigin, string> = {
  'claude-user': 'Claude user',
  'claude-project': 'Claude project',
  'codex-user': 'Codex user',
};

/** The MCP config layers, in surface words (`.mcp.json` names itself — it is the
 *  one the project commits). */
export const LAYER_LABEL: Record<McpLayer, string> = {
  'claude-local': 'Claude local',
  'project-mcp': '.mcp.json',
  'claude-user': 'Claude user',
};

/** One line of an MCP server's config — what would actually run/connect, stated
 *  rather than summarized away. Exported for direct testing. */
export function mcpSummary(config: McpServerEntry): string {
  if (config.transport === 'stdio') return [config.command, ...(config.args ?? [])].join(' ');
  return config.url;
}

/** A store entry's resolution problem, in surface words; `undefined` when it is fine. */
export function entryProblem(entry: LibraryEntryView): string | undefined {
  if (entry.status === 'source-missing') return 'Source missing';
  if (entry.status === 'invalid-source') return 'Invalid source';
  return undefined;
}

/* ------------------------------- pure selection ------------------------------- */

/** The entries a tab shows for one scope, in stable name order. */
export function entriesFor(
  view: LibraryView,
  tab: LibraryTab,
  scope: 'personal' | 'project',
): LibraryEntryView[] {
  const kind = tab === 'skills' ? 'skill' : 'mcp';
  return view.entries
    .filter((e) => e.record.kind === kind && e.scope === scope)
    .sort((a, b) => a.record.name.localeCompare(b.record.name));
}

/* --------------------------------- the rows --------------------------------- */

/** A quiet fact pill (the agent editor's scope-pill vocabulary). */
function ModePill({ mode }: { mode: 'reference' | 'copy' }): React.JSX.Element {
  return (
    <span className="flex-none rounded-r1 border border-s5 px-1.5 py-0.5 font-mono text-meta text-s8">
      {mode === 'reference' ? 'Reference' : 'Copy'}
    </span>
  );
}

/** One store entry: identity · mode · health · enabled · actions. The row never
 *  hides a problem — a broken source keeps its row and wears the reason. */
function EntryRow({
  entry,
  store,
}: {
  entry: LibraryEntryView;
  store: Pick<LibraryState, 'copy' | 'unlink' | 'setEnabled'>;
}): React.JSX.Element {
  const { record, scope } = entry;
  const kind = record.kind;
  const name = record.name;
  const problem = entryProblem(entry);
  const description =
    kind === 'skill'
      ? entry.skill?.description
      : entry.mcp !== undefined
        ? mcpSummary(entry.mcp)
        : undefined;
  const drifted = entry.drift === 'drifted';
  const resync = (): void =>
    void store.copy({
      kind,
      source: {
        path: record.source.path,
        ...(record.source.serverName !== undefined ? { serverName: record.source.serverName } : {}),
      },
      name,
    });

  return (
    <div
      role="listitem"
      aria-label={name}
      className="group -mx-3 flex items-center gap-2.5 rounded-r3 px-3 py-2 hover:bg-s2"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cx(
              'truncate text-sec',
              record.enabled ? 'text-s11' : 'text-s7 line-through decoration-s6',
            )}
          >
            {name}
          </span>
          {kind === 'mcp' && entry.mcp !== undefined && (
            <span className="flex-none font-mono text-meta text-s7">{entry.mcp.transport}</span>
          )}
        </span>
        {description !== undefined && description !== '' && (
          <span className={cx('truncate text-meta text-s7', kind === 'mcp' && 'font-mono')}>
            {description}
          </span>
        )}
      </span>

      {/* Health before controls: a problem outranks chrome. Amber for a missing
          source (fixable by relinking), red for one that no longer parses. */}
      {problem !== undefined && (
        <span className="flex flex-none items-center gap-1.5 font-mono text-meta text-warn">
          <StatusDot status={entry.status === 'invalid-source' ? 'critical' : 'needs-you'} />
          {problem}
        </span>
      )}
      {/* Drift on copies only. In-sync renders nothing (indicator law: zero is
          silent); a drifted copy earns the amber dot + the one-click re-copy. A
          copy whose original vanished states the fact quietly — the store is the
          source of truth, so nothing here is broken. */}
      {drifted && (
        <span className="flex flex-none items-center gap-1.5">
          <StatusDot status="needs-you" />
          <span className="font-mono text-meta text-warn">Drifted</span>
          <Button variant="outline" onClick={resync}>
            Re-sync
          </Button>
        </span>
      )}
      {entry.drift === 'source-missing' && (
        <span className="flex-none font-mono text-meta text-s7">Source gone</span>
      )}

      <ModePill mode={record.mode} />
      <Toggle
        on={record.enabled}
        onChange={(on) => void store.setEnabled({ kind, scope, name }, on)}
        aria-label={`${name} enabled`}
      />
      <RowMenu label={`${name} actions`}>
        {record.mode === 'reference' && (
          <MenuItem
            onClick={() =>
              void store.copy({
                kind,
                source: {
                  path: record.source.path,
                  ...(record.source.serverName !== undefined
                    ? { serverName: record.source.serverName }
                    : {}),
                },
                name,
              })
            }
          >
            Copy into Project
          </MenuItem>
        )}
        {drifted && <MenuItem onClick={resync}>Re-sync from Source</MenuItem>}
        <MenuItem onClick={() => void store.unlink({ kind, scope, name })}>
          <span className="text-crit">Unlink</span>
        </MenuItem>
      </RowMenu>
    </div>
  );
}

/** The link/copy chooser a discovered row carries — an explicit scope choice, never
 *  a silently-picked default (link-as-reference is the default MODE; the scope is
 *  still the user's call). */
function LinkMenu({
  label,
  onLink,
  onCopy,
}: {
  label: string;
  onLink: (scope: 'personal' | 'project') => void;
  onCopy: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="w-48"
      trigger={
        <button
          type="button"
          aria-label={label}
          className="slip slip-press w-fit flex-none cursor-pointer rounded-r2 border border-s5 bg-s4 px-2 py-1 font-mono text-code text-s9 hover:bg-s5 hover:text-s12 active:scale-[0.97]"
        >
          Link
        </button>
      }
    >
      <div onClick={() => setOpen(false)}>
        <MenuItem onClick={() => onLink('project')}>Link to Project</MenuItem>
        <MenuItem onClick={() => onLink('personal')}>Link to Personal</MenuItem>
        <div className="my-1 h-px bg-s5" />
        {/* A copy is committable and drift-tracked; it always lands in the project. */}
        <MenuItem onClick={onCopy}>Copy into Project</MenuItem>
      </div>
    </PopoverCard>
  );
}

/** A discovered skill: found on disk, claimed by no store yet. */
function DiscoveredSkillRow({
  skill,
  store,
}: {
  skill: DiscoveredSkill;
  store: Pick<LibraryState, 'link' | 'copy'>;
}): React.JSX.Element {
  return (
    <div
      role="listitem"
      aria-label={skill.name}
      className="group -mx-3 flex items-center gap-2.5 rounded-r3 px-3 py-2 hover:bg-s2"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-sec text-s11">{skill.name}</span>
        {skill.description !== '' && (
          <span className="truncate text-meta text-s7">{skill.description}</span>
        )}
      </span>
      <Tooltip label={skill.path} side="top">
        <span tabIndex={0} className="slip flex-none rounded-r1 font-mono text-meta text-s7">
          {ORIGIN_LABEL[skill.origin]}
        </span>
      </Tooltip>
      <LinkMenu
        label={`Link ${skill.name}`}
        onLink={(scope) => void store.link({ kind: 'skill', scope, source: { path: skill.path } })}
        onCopy={() => void store.copy({ kind: 'skill', source: { path: skill.path } })}
      />
    </div>
  );
}

/** A discovered MCP server. A shadowed row says so — precedence is surfaced, never
 *  silently applied. */
function DiscoveredMcpRow({
  server,
  store,
}: {
  server: DiscoveredMcpServer;
  store: Pick<LibraryState, 'link' | 'copy'>;
}): React.JSX.Element {
  const source = { path: server.configPath, serverName: server.name };
  return (
    <div
      role="listitem"
      aria-label={server.name}
      className="group -mx-3 flex items-center gap-2.5 rounded-r3 px-3 py-2 hover:bg-s2"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sec text-s11">{server.name}</span>
          <span className="flex-none font-mono text-meta text-s7">{server.config.transport}</span>
        </span>
        <span className="truncate font-mono text-meta text-s7">{mcpSummary(server.config)}</span>
      </span>
      {server.shadowedBy !== undefined && (
        <span className="flex-none font-mono text-meta text-warn">
          Shadowed by {LAYER_LABEL[server.shadowedBy]}
        </span>
      )}
      <Tooltip label={server.configPath} side="top">
        <span tabIndex={0} className="slip flex-none rounded-r1 font-mono text-meta text-s7">
          {LAYER_LABEL[server.layer]}
        </span>
      </Tooltip>
      <LinkMenu
        label={`Link ${server.name}`}
        onLink={(scope) => void store.link({ kind: 'mcp', scope, source })}
        onCopy={() => void store.copy({ kind: 'mcp', source })}
      />
    </div>
  );
}

/* -------------------------------- the sections -------------------------------- */

/** One quiet line for a section with nothing in it — every section states its
 *  emptiness rather than vanishing (first-run honesty). */
function SectionEmpty({ text }: { text: string }): React.JSX.Element {
  return <div className="px-0 py-1 font-mono text-meta text-s6">{text}</div>;
}

function Section({
  label,
  empty,
  count,
  children,
}: {
  label: string;
  empty: string;
  count: number;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div role="list" aria-label={label} className="flex flex-col">
      <CapsLabel className="px-0 pb-1.5">{label}</CapsLabel>
      {count === 0 ? <SectionEmpty text={empty} /> : children}
    </div>
  );
}

/** Every scan/store/resolution problem, one line each — reported, never swallowed
 *  (the AgentDiagnosticsBanner posture). */
function LibraryDiagnostics({
  diagnostics,
}: {
  diagnostics: LibraryDiagnostic[];
}): React.JSX.Element | null {
  if (diagnostics.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-s3 px-5 py-2.5">
      {diagnostics.map((d, i) => (
        <InlineMessage key={`${d.path}/${d.problem}/${i}`} tone="warning" className="text-code">
          {d.name !== undefined && <span className="font-mono">{d.name} — </span>}
          {d.problem === 'missing-source'
            ? 'missing source'
            : d.problem === 'duplicate'
              ? 'duplicate'
              : 'invalid'}
          : {d.detail} <span className="font-mono text-s7">({d.path})</span>
        </InlineMessage>
      ))}
    </div>
  );
}

/* --------------------------------- the surface --------------------------------- */

function SkillsTab({
  view,
  store,
}: {
  view: LibraryView;
  store: Pick<LibraryState, 'link' | 'copy' | 'unlink' | 'setEnabled'>;
}): React.JSX.Element {
  const personal = entriesFor(view, 'skills', 'personal');
  const project = entriesFor(view, 'skills', 'project');
  const discovered = view.discovered.skills;
  return (
    <>
      <Section label="Personal skills" empty="Nothing linked" count={personal.length}>
        {personal.map((e) => (
          <EntryRow key={e.record.name} entry={e} store={store} />
        ))}
      </Section>
      <Section label="Project skills" empty="Nothing linked" count={project.length}>
        {project.map((e) => (
          <EntryRow key={e.record.name} entry={e} store={store} />
        ))}
      </Section>
      <Section
        label="Discovered"
        empty="Nothing discovered on this machine"
        count={discovered.length}
      >
        {discovered.map((s) => (
          <DiscoveredSkillRow key={s.path} skill={s} store={store} />
        ))}
      </Section>
    </>
  );
}

function McpTab({
  view,
  store,
}: {
  view: LibraryView;
  store: Pick<LibraryState, 'link' | 'copy' | 'unlink' | 'setEnabled'>;
}): React.JSX.Element {
  const personal = entriesFor(view, 'mcp', 'personal');
  const project = entriesFor(view, 'mcp', 'project');
  const discovered = view.discovered.mcpServers;
  return (
    <>
      <Section label="Personal servers" empty="Nothing linked" count={personal.length}>
        {personal.map((e) => (
          <EntryRow key={e.record.name} entry={e} store={store} />
        ))}
      </Section>
      <Section label="Project servers" empty="Nothing linked" count={project.length}>
        {project.map((e) => (
          <EntryRow key={e.record.name} entry={e} store={store} />
        ))}
      </Section>
      <Section
        label="Discovered"
        empty="Nothing discovered in the MCP config layers"
        count={discovered.length}
      >
        {discovered.map((s) => (
          <DiscoveredMcpRow key={`${s.configPath}::${s.name}`} server={s} store={store} />
        ))}
      </Section>
    </>
  );
}

/** The title bar IS the surface's chrome (the auth/usage convention): the surface's
 *  name + entry count, the Skills/MCP switch, and the rescan gesture — the ONLY
 *  freshness control (drift is hash-on-demand; nothing watches the disk). */
export function LibraryStrip(): React.JSX.Element {
  const tab = useLibraryUi((s) => s.tab);
  const setTab = useLibraryUi((s) => s.setTab);
  const read = useLibraryStore((s) => s.read);
  const rescan = useLibraryStore((s) => s.rescan);
  const count = read.status === 'ok' ? read.view.entries.length : 0;

  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5 px-4" style={NO_DRAG}>
        <span className="font-mono text-meta tracking-[0.06em] text-s9">Library</span>
        {count > 0 && (
          <span className="font-mono text-meta text-s7">
            {count} {count === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1 pr-1" style={NO_DRAG}>
        <Segmented
          options={LIBRARY_TABS.map((t) => ({ value: t, label: LIBRARY_TAB_LABEL[t] }))}
          value={tab}
          onChange={(t) => setTab(t as LibraryTab)}
          layoutId="library-tab"
        />
        <Tooltip label="Rescan the library" side="bottom">
          <button
            type="button"
            aria-label="Rescan the library"
            onClick={() => void rescan()}
            className="slip flex cursor-pointer items-center px-3.5 text-s7 hover:text-s10"
          >
            <Icon name="refresh" />
          </button>
        </Tooltip>
      </div>
    </>
  );
}

/** The surface body: diagnostics first (never swallowed), then the active tab's
 *  three sections. Reads render states-first: loading skeleton · error line ·
 *  sections (each with its own honest empty). */
export function LibrarySurface(): React.JSX.Element {
  const read = useLibraryStore((s) => s.read);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const link = useLibraryStore((s) => s.link);
  const copy = useLibraryStore((s) => s.copy);
  const unlink = useLibraryStore((s) => s.unlink);
  const setEnabled = useLibraryStore((s) => s.setEnabled);
  const tab = useLibraryUi((s) => s.tab);

  // Mount = the first read (idempotent; a later visit re-reads and keeps the last
  // good view meanwhile). Advisory: a failed read renders the error state below.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const store = { link, copy, unlink, setEnabled };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {read.status === 'ok' && <LibraryDiagnostics diagnostics={read.view.diagnostics} />}
      {read.status === 'loading' && <SkeletonLines widths={['w-40', 'w-64', 'w-52']} />}
      {read.status === 'error' && <SurfaceError message={read.message} />}
      {read.status === 'ok' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 pt-5 pb-7">
            {tab === 'skills' ? (
              <SkillsTab view={read.view} store={store} />
            ) : (
              <McpTab view={read.view} store={store} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
