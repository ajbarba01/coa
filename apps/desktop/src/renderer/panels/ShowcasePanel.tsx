import { useState } from 'react';
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import {
  AgentChip,
  AgentRail,
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Checkbox,
  Code,
  Combobox,
  DenyNotice,
  Dialog,
  Divider,
  EmptyState,
  Field,
  Icon,
  IconButton,
  IdentityPicker,
  InlineEdit,
  InlineMessage,
  KeyValue,
  Link,
  List,
  Menu,
  NavList,
  Pane,
  Popover,
  Progress,
  Radio,
  Select,
  Sheet,
  Skeleton,
  Spinner,
  Stat,
  Switch,
  SwitcherMenu,
  Table,
  TextField,
  Toast,
  ToastProvider,
  Toolbar,
  Tooltip,
  TooltipProvider,
  TranscriptRow,
} from '@coa/console-ui';
import type { AgentColorName, AgentIconName } from '@coa/console-ui';
import {
  ArrowRight,
  ChevronDown,
  Copy,
  Download,
  Flag,
  History,
  Inbox,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import type { ConsoleState } from './state.js';
import { Family, Row } from './showcase/Specimen.js';

/** A no-op handler for the inert showcase specimens (nothing here drives the daemon). */
const noop = (): void => {};

function FoundationsSection(): React.JSX.Element {
  return (
    <Family name="Foundations">
      <Row label="Icon · sizes">
        <Icon name={Wallet} size={16} />
        <Icon name={Flag} size={20} />
        <Icon name={History} size={24} />
      </Row>
      <Row label="Icon · labelled">
        <Icon name={ShieldCheck} size={20} label="Governed" />
      </Row>
    </Family>
  );
}

function ActionsSection(): React.JSX.Element {
  return (
    <Family name="Actions">
      <Row label="Button · variants">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="tertiary">Tertiary</Button>
        <Button variant="danger">Danger</Button>
      </Row>
      <Row label="Button · sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
      </Row>
      <Row label="Button · with icon">
        <Button variant="secondary">
          <Icon name={Play} size={14} />
          Run
        </Button>
        <Button variant="secondary">
          Continue
          <Icon name={ArrowRight} size={14} />
        </Button>
      </Row>
      <Row label="Button · states">
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
      </Row>
      <Row label="IconButton">
        <IconButton icon={Copy} label="Copy" variant="secondary" />
        <IconButton icon={RotateCcw} label="Rewind" variant="tertiary" />
        <IconButton icon={Trash2} label="Delete" variant="danger" />
        <IconButton icon={Copy} label="Copying" loading />
        <IconButton icon={Copy} label="Copy disabled" disabled />
      </Row>
      <Row label="ButtonGroup">
        <ButtonGroup label="Confirm or cancel">
          <Button variant="tertiary" size="sm">
            Cancel
          </Button>
          <Button variant="primary" size="sm">
            Confirm
          </Button>
        </ButtonGroup>
      </Row>
      <Row label="Link">
        <Link href="#" onClick={(e) => e.preventDefault()}>
          Default link
        </Link>
        <Link href="#" tone="muted" onClick={(e) => e.preventDefault()}>
          Muted link
        </Link>
        <Link href="https://example.com" external onClick={(e) => e.preventDefault()}>
          External link
        </Link>
      </Row>
      <Row label="Menu">
        <Menu
          trigger={
            <Button variant="secondary">
              Actions
              <Icon name={ChevronDown} size={14} />
            </Button>
          }
          items={[
            { id: 'rewind', label: 'Rewind here', icon: RotateCcw, onSelect: noop },
            { id: 'copy', label: 'Copy id', icon: Copy, onSelect: noop },
            { id: 'delete', label: 'Delete', icon: Trash2, disabled: true },
          ]}
        />
      </Row>
    </Family>
  );
}

function InputsSection(): React.JSX.Element {
  return (
    <Family name="Inputs">
      <Row label="TextField" align="start">
        <TextField label="Name" placeholder="e.g. auth-refactor" className="w-44" />
        <TextField
          label="Path"
          description="Repo-relative."
          defaultValue="src/auth.ts"
          className="w-44"
        />
        <TextField label="Query" error="This field is required." className="w-44" />
        <TextField label="Disabled" disabled defaultValue="locked" className="w-44" />
      </Row>
      <Row label="Field · custom" align="start">
        <Field
          label="Retry budget"
          description="Field wires label + description + error to any control."
          error="Must be 0–10."
        >
          {(ids) => (
            <input
              type="number"
              aria-labelledby={ids.labelId}
              aria-describedby={ids.describedBy}
              aria-invalid={ids.invalid || undefined}
              defaultValue={42}
              className="h-9 w-44 rounded-control border border-danger bg-element px-2.5 text-body text-fg"
            />
          )}
        </Field>
      </Row>
      <Row label="Select" align="start">
        <Select
          label="Model"
          defaultValue="opus"
          options={[
            { value: 'opus', label: 'Opus 4.8' },
            { value: 'sonnet', label: 'Sonnet 5' },
            { value: 'haiku', label: 'Haiku 4.5 (disabled)', disabled: true },
          ]}
        />
        <Select
          label="Disabled"
          disabled
          placeholder="Unavailable"
          options={[{ value: 'a', label: 'A' }]}
        />
      </Row>
      <Row label="Combobox" align="start">
        <Combobox
          label="Account"
          placeholder="Filter accounts…"
          options={[
            { value: '1', label: 'Pro · acct-1' },
            { value: '2', label: 'Pro · acct-2' },
            { value: '3', label: 'Max · acct-3' },
          ]}
        />
      </Row>
      <Row label="Checkbox">
        <Checkbox label="Verbose logging" />
        <Checkbox label="Checked" defaultChecked />
        <Checkbox label="Disabled" disabled />
      </Row>
      <Row label="Radio" align="start">
        <Radio
          label="Density"
          defaultValue="compact"
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'auto', label: 'Auto (disabled)', disabled: true },
          ]}
        />
      </Row>
      <Row label="Switch">
        <Switch label="Reduce motion" />
        <Switch label="On" defaultChecked />
        <Switch label="Disabled" disabled />
      </Row>
    </Family>
  );
}

interface FlagRow {
  id: string;
  severity: 'crit' | 'high' | 'med';
  text: string;
}
const FLAG_ITEMS: FlagRow[] = [
  { id: 'a', severity: 'crit', text: 'Symbol drift: refreshToken no longer exists' },
  { id: 'b', severity: 'high', text: 'Untested branch in error path' },
  { id: 'c', severity: 'med', text: 'TODO left in src/auth.ts' },
];
const flagTone: Record<FlagRow['severity'], 'danger' | 'warning' | 'neutral'> = {
  crit: 'danger',
  high: 'warning',
  med: 'neutral',
};

interface CheckpointRow {
  id: string;
  turn: string;
  label: string;
  cost: string;
}
const CHECKPOINTS: CheckpointRow[] = [
  { id: '8', turn: '8', label: 'pre-refactor', cost: '$1.20' },
  { id: '10', turn: '10', label: 'imports swapped', cost: '$1.74' },
  { id: '12', turn: '12', label: 'tests green', cost: '$2.14' },
];
const checkpointColumns = [
  { key: 'turn', header: 'Turn' },
  { key: 'label', header: 'Checkpoint' },
  { key: 'cost', header: 'Cost', align: 'end' as const },
];

function DataSection(): React.JSX.Element {
  return (
    <Family name="Data-display">
      <Row label="Badge">
        <Badge>neutral</Badge>
        <Badge tone="info">info</Badge>
        <Badge tone="success">success</Badge>
        <Badge tone="warning">warning</Badge>
        <Badge tone="danger">danger</Badge>
      </Row>
      <Row label="Code · inline">
        <Code>src/auth.ts</Code>
        <Code>coa serve</Code>
      </Row>
      <Row label="Code · block" align="start">
        <Code block>{'{\n  "path": "src/auth.ts",\n  "mode": "write"\n}'}</Code>
      </Row>
      <Row label="Stat">
        <Stat label="Cost" value="$2.14" sub="of $5.00 cap" />
        <Stat label="Turns" value="12" tone="info" />
        <Stat label="Flags" value="3" tone="warning" />
        <Stat label="Denied" value="1" tone="danger" />
      </Row>
      <Row label="KeyValue" align="start">
        <KeyValue
          pairs={[
            { key: 'model', value: 'Opus 4.8' },
            { key: 'turns', value: '12' },
            { key: 'mode', value: 'attended' },
          ]}
        />
      </Row>
      <Row label="List" align="start">
        <List
          label="Flags"
          items={FLAG_ITEMS}
          getKey={(f) => f.id}
          className="w-80"
          renderItem={(f) => (
            <span className="flex items-center gap-2">
              <Badge tone={flagTone[f.severity]}>{f.severity}</Badge>
              <span className="min-w-0 truncate">{f.text}</span>
            </span>
          )}
        />
      </Row>
      <Row label="Table" align="start">
        <Table
          className="w-80"
          caption="Checkpoints"
          columns={checkpointColumns}
          rows={CHECKPOINTS}
          getRowId={(r) => r.id}
        />
      </Row>
      <Row label="Table · empty" align="start">
        <Table
          className="w-80"
          caption="Checkpoints (empty)"
          columns={checkpointColumns}
          rows={[]}
          getRowId={(r: CheckpointRow) => r.id}
          empty="No checkpoints yet."
        />
      </Row>
    </Family>
  );
}

function DismissibleBanner(): React.JSX.Element {
  const [shown, setShown] = useState(true);
  if (!shown)
    return (
      <Button variant="tertiary" size="sm" onClick={() => setShown(true)}>
        Restore banner
      </Button>
    );
  return (
    <Banner tone="warning" title="Running in degraded mode" onDismiss={() => setShown(false)}>
      The grammar for this language is unavailable; falling back to the neutral floor.
    </Banner>
  );
}

function ToastDemo(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <ToastProvider>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Show toast
      </Button>
      <Toast open={open} onOpenChange={setOpen} tone="success" title="Settings saved">
        Your theme preference was applied.
      </Toast>
    </ToastProvider>
  );
}

function FeedbackSection(): React.JSX.Element {
  return (
    <Family name="Feedback">
      <Row label="Banner" align="start">
        <div className="flex w-96 flex-col gap-2">
          <Banner tone="info" title="Attended session">
            A human is present for every turn in v1.
          </Banner>
          <Banner tone="success" title="Checkpoint created" />
          <DismissibleBanner />
          <Banner tone="danger" title="Daemon unreachable">
            Start <Code>coa serve</Code> to reconnect.
          </Banner>
        </div>
      </Row>
      <Row label="DenyNotice" align="start">
        <div className="flex w-96 flex-col gap-2">
          <DenyNotice
            kind="cost-cap"
            reason="Session cost cap reached ($5.00)."
            detail="Raise the cap or start a new session to continue."
          />
          <DenyNotice
            kind="close-gate"
            reason="Type-1 close-gate: 2 critical flags are unresolved."
          />
        </div>
      </Row>
      <Row label="InlineMessage">
        <InlineMessage tone="info">Syncing…</InlineMessage>
        <InlineMessage tone="success">Saved</InlineMessage>
        <InlineMessage tone="warning">Unsaved changes</InlineMessage>
        <InlineMessage tone="danger">Failed to load</InlineMessage>
      </Row>
      <Row label="Progress" align="start">
        <div className="flex w-64 flex-col gap-2">
          <Progress label="Indexing" value={30} />
          <Progress label="Compiling" value={80} />
        </div>
      </Row>
      <Row label="Spinner">
        <Spinner />
        <Spinner size={20} />
      </Row>
      <Row label="Skeleton" align="start">
        <div className="flex w-64 flex-col gap-2">
          <Skeleton className="w-2/3" />
          <Skeleton className="w-full" />
          <Skeleton className="w-1/2" />
        </div>
      </Row>
      <Row label="EmptyState" align="start">
        <div className="w-72 rounded-surface border border-hairline">
          <EmptyState
            icon={Inbox}
            title="No flags"
            description="Nothing needs your attention on this turn."
          />
        </div>
        <div className="w-72 rounded-surface border border-hairline">
          <EmptyState
            icon={Inbox}
            title="No conversation yet"
            description="Turns appear here as you drive the agent."
            action={
              <Button variant="secondary" size="sm">
                Start a session
              </Button>
            }
          />
        </div>
      </Row>
      <Row label="Toast">
        <ToastDemo />
      </Row>
    </Family>
  );
}

function OverlaysSection(): React.JSX.Element {
  return (
    <Family name="Overlays">
      <Row label="Dialog">
        <Dialog
          trigger={<Button variant="secondary">Open dialog</Button>}
          title="Rewind to checkpoint?"
          description="This resets the working tree to turn 8."
          footer={
            <>
              <Button variant="tertiary" size="sm">
                Cancel
              </Button>
              <Button variant="primary" size="sm">
                Rewind
              </Button>
            </>
          }
        >
          <p className="text-muted">Any changes made after turn 8 will be discarded.</p>
        </Dialog>
      </Row>
      <Row label="Popover">
        <Popover trigger={<Button variant="secondary">Open popover</Button>}>
          <div className="flex flex-col gap-1">
            <div className="font-medium text-fg">Turn 12</div>
            <div className="text-muted">Supplemental detail shown on demand.</div>
          </div>
        </Popover>
      </Row>
      <Row label="Sheet">
        <Sheet
          side="right"
          title="Agent configuration"
          trigger={<Button variant="secondary">Open sheet (right)</Button>}
        >
          <p className="text-muted">A side surface for forms that need room.</p>
        </Sheet>
        <Sheet
          side="left"
          title="Left sheet"
          trigger={
            <Button variant="tertiary" size="sm">
              Left
            </Button>
          }
        >
          <p className="text-muted">Left-anchored variant.</p>
        </Sheet>
      </Row>
      <Row label="Tooltip">
        <TooltipProvider>
          <Tooltip content="Copy the session id">
            <IconButton icon={Copy} label="Copy" variant="tertiary" />
          </Tooltip>
        </TooltipProvider>
      </Row>
    </Family>
  );
}

function NavListDemo(): React.JSX.Element {
  const [active, setActive] = useState('cost');
  return (
    <NavList
      label="Sections"
      activeId={active}
      onSelect={setActive}
      className="w-44"
      items={[
        { id: 'cost', label: 'Cost', icon: Wallet },
        { id: 'flags', label: 'Flags', icon: Flag },
        { id: 'timeline', label: 'Timeline', icon: History },
      ]}
    />
  );
}

function LayoutSection(): React.JSX.Element {
  return (
    <Family name="Layout">
      <Row label="Divider" align="start">
        <div className="w-44">
          <div className="text-muted">Above</div>
          <Divider className="my-2" />
          <div className="text-muted">Below</div>
        </div>
        <div className="flex h-10 items-center gap-3">
          <span className="text-muted">Left</span>
          <Divider orientation="vertical" />
          <span className="text-muted">Right</span>
        </div>
      </Row>
      <Row label="Toolbar">
        <Toolbar label="Transcript actions">
          <IconButton icon={RotateCcw} label="Rewind" variant="tertiary" size="sm" />
          <IconButton icon={Copy} label="Copy" variant="tertiary" size="sm" />
          <Divider orientation="vertical" className="mx-1 h-5" />
          <IconButton icon={Download} label="Export" variant="tertiary" size="sm" />
        </Toolbar>
      </Row>
      <Row label="NavList" align="start">
        <NavListDemo />
      </Row>
      <Row label="Pane" align="start">
        <div className="h-40 w-72">
          <Pane title="Example pane" scroll>
            <KeyValue
              pairs={[
                { key: 'role', value: 'refactor' },
                { key: 'scope', value: 'src/auth/**' },
                { key: 'model', value: 'Opus 4.8' },
              ]}
            />
          </Pane>
        </div>
      </Row>
    </Family>
  );
}

function DenseSection(): React.JSX.Element {
  return (
    <Family name="Dense / Viz">
      <Row label="Transcript rows" align="start">
        <div className="w-full max-w-2xl rounded-surface border border-hairline bg-surface">
          <TranscriptRow
            frame={{
              id: '1',
              role: 'you',
              kind: 'text',
              text: 'Refactor the auth module to use the new token helper.',
            }}
          />
          <TranscriptRow
            frame={{
              id: '2',
              role: 'agent',
              kind: 'tool-use',
              tool: 'read_file',
              input: '{ "path": "src/auth.ts" }',
            }}
          />
          <TranscriptRow
            frame={{
              id: '3',
              role: 'agent',
              kind: 'tool-result',
              tool: 'read_file',
              ok: true,
              output: 'export function refreshToken(session) { /* … */ }',
            }}
          />
          <TranscriptRow
            frame={{
              id: '4',
              kind: 'approval',
              requestId: 'r1',
              tool: 'write_file',
              summary: 'src/auth.ts',
              diffStat: '+42 −18',
            }}
            onRespond={noop}
          />
          <TranscriptRow
            frame={{
              id: '5',
              kind: 'approval',
              requestId: 'r2',
              tool: 'write_file',
              summary: 'src/auth.ts',
              resolved: 'approved',
            }}
          />
          <TranscriptRow
            frame={{
              id: '6',
              kind: 'deny',
              denyKind: 'cost-cap',
              reason: 'Session cost cap reached ($5.00).',
            }}
          />
          <TranscriptRow
            frame={{
              id: '7',
              role: 'subagent',
              kind: 'text',
              text: 'Reviewing the diff…',
              depth: 1,
            }}
          />
          <TranscriptRow
            frame={{
              id: '8',
              kind: 'raw',
              text: '> agent: tool_use read_file { "path": "src/auth.ts" }',
            }}
          />
        </div>
      </Row>
      <Row label="Deferred">
        <span className="text-label text-muted">
          Longform · DiffView · Graph · Timeline — the remaining P11 members, not yet built.
        </span>
      </Row>
    </Family>
  );
}

function IdentityDemo(): React.JSX.Element {
  const [icon, setIcon] = useState<AgentIconName>('wrench');
  const [color, setColor] = useState<AgentColorName>('coral');
  const [name, setName] = useState('refactor-bot');
  return (
    <div className="flex items-center gap-3">
      <IdentityPicker
        icon={icon}
        color={color}
        label={name}
        onIconChange={setIcon}
        onColorChange={setColor}
      />
      <InlineEdit
        value={name}
        label="Agent name"
        textClassName="text-heading font-semibold"
        onCommit={setName}
      />
    </div>
  );
}

const RAIL_AGENTS = [
  { id: 'a', name: 'reviewer', icon: 'search', color: 'teal', pinned: true },
  { id: 'b', name: 'tdd-implementer', icon: 'flask', color: 'blue' },
  { id: 'c', name: 'refactor-bot', icon: 'wrench', color: 'coral' },
  { id: 'd', name: 'scratch-helper', icon: 'sparkles', color: 'violet' },
] as const;

function AgentRailDemo(): React.JSX.Element {
  const [active, setActive] = useState('a');
  return (
    <div className="h-40 w-full max-w-md rounded-surface border border-hairline bg-surface">
      <div className="flex h-full">
        <AgentRail
          items={[...RAIL_AGENTS]}
          activeId={active}
          onSelect={setActive}
          onTogglePin={noop}
        />
        <div className="flex-1 p-3 text-label text-muted">
          Hover the icon column — the names slide out from behind it without moving the icons.
        </div>
      </div>
    </div>
  );
}

function AgentsSection(): React.JSX.Element {
  return (
    <Family name="Agents / identity">
      <Row label="AgentChip · colors">
        {(['slate', 'sky', 'blue', 'teal', 'green', 'mauve', 'violet', 'coral'] as const).map(
          (c) => (
            <AgentChip key={c} icon="bot" color={c} label={c} />
          ),
        )}
      </Row>
      <Row label="AgentChip · sizes">
        <AgentChip icon="hammer" color="coral" size="sm" />
        <AgentChip icon="hammer" color="coral" size="md" />
        <AgentChip icon="hammer" color="coral" size="lg" />
      </Row>
      <Row label="IdentityPicker + InlineEdit" align="start">
        <IdentityDemo />
      </Row>
      <Row label="SwitcherMenu">
        <SwitcherMenu
          label="Agents"
          trigger={
            <Button variant="secondary" size="sm">
              <AgentChip icon="search" color="teal" size="sm" />
              reviewer
              <ChevronDown aria-hidden size={14} className="text-muted" />
            </Button>
          }
          groups={[
            {
              id: 'pinned',
              label: 'Pinned',
              options: [
                {
                  id: 'a',
                  label: 'reviewer',
                  meta: '2h',
                  selected: true,
                  leading: <AgentChip icon="search" color="teal" size="sm" />,
                },
              ],
            },
            {
              id: 'project',
              label: 'Project',
              options: [
                {
                  id: 'b',
                  label: 'tdd-implementer',
                  leading: <AgentChip icon="flask" color="blue" size="sm" />,
                },
              ],
              actions: [{ id: 'new', label: 'New agent', icon: Plus }],
            },
          ]}
          onSelect={noop}
          onAction={noop}
        />
      </Row>
      <Row label="AgentRail" align="start">
        <AgentRailDemo />
      </Row>
    </Family>
  );
}

function ShowcaseView(_props: { vm: null; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Components" scroll seam="left">
      <div className="mx-auto flex max-w-3xl flex-col gap-9 pb-10">
        <p className="text-label text-muted">
          Every primitive in <Code>@coa/console-ui</Code>, grouped by family — a live reference for
          the hardening pass. Specimens are inert.
        </p>
        <FoundationsSection />
        <ActionsSection />
        <InputsSection />
        <DataSection />
        <FeedbackSection />
        <OverlaysSection />
        <LayoutSection />
        <AgentsSection />
        <DenseSection />
      </div>
    </Pane>
  );
}

export const showcasePanel: PanelDefinition<null, ConsoleState> = {
  id: 'showcase',
  displayName: 'Components',
  render: ShowcaseView,
  selectVm: () => null,
};
