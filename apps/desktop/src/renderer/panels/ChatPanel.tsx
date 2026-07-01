import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Button, EmptyState, InlineMessage, Pane, Skeleton, Transcript } from '@coa/console-ui';
import type { RespondFn, TranscriptFrame } from '@coa/console-ui';
import type { TurnFrame } from '@coa/console-viewmodel';
import { MessageSquare } from 'lucide-react';
import type { ConsoleState } from './state.js';

export type ChatVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      rawMode: boolean;
      frames: TranscriptFrame[];
      onRespond: RespondFn;
      toggleRaw: () => void;
    };

/** Map a daemon turn frame to its governed transcript frame. Approvals/denies pass
 *  their fields straight through; `resolved` is layered on in a later part from ui state. */
export function toGovernedFrame(f: TurnFrame): TranscriptFrame {
  switch (f.kind) {
    case 'text':
      return { id: f.id, role: f.role, kind: 'text', text: f.text, depth: f.depth };
    case 'tool-use':
      return {
        id: f.id,
        role: f.role,
        kind: 'tool-use',
        tool: f.tool,
        input: f.input,
        depth: f.depth,
      };
    case 'tool-result':
      return {
        id: f.id,
        role: f.role,
        kind: 'tool-result',
        tool: f.tool,
        output: f.output,
        ok: f.ok,
        depth: f.depth,
      };
    case 'approval':
      return {
        id: f.id,
        kind: 'approval',
        requestId: f.requestId,
        tool: f.tool,
        summary: f.summary,
        diffStat: f.diffStat,
      };
    case 'deny':
      return { id: f.id, kind: 'deny', denyKind: f.denyKind, reason: f.reason };
  }
}

/** The verbatim (unfiltered-loop) projection of one frame. Mock stand-in for the
 *  turn store's raw bytes; rendered byte-faithfully via the Code block (D128). */
export function frameToRawLine(f: TurnFrame): string {
  switch (f.kind) {
    case 'text':
      return `> ${f.role}: ${f.text}`;
    case 'tool-use':
      return `> ${f.role}: tool_use ${f.tool} ${f.input}`;
    case 'tool-result':
      return `> ${f.role}: tool_result ${f.tool} ${f.ok ? 'ok' : 'error'} ${f.output}`;
    case 'approval':
      return `> control: approval_request ${f.tool} (${f.requestId})`;
    case 'deny':
      return `> control: deny ${f.denyKind} ${f.reason}`;
  }
}

/** Pure: projects the polled turn stream into transcript frames. In raw mode every
 *  frame becomes its verbatim line (D85); otherwise a resolved approval is overlaid
 *  from ui state. */
export function selectChatVm(state: ConsoleState): ChatVm {
  const r = state.data.turns;
  if (r.status !== 'ok') return r;
  const { rawMode, resolvedApprovals } = state.ui;
  const frames: TranscriptFrame[] = rawMode
    ? r.value.map((f) => ({ id: f.id, kind: 'raw', text: frameToRawLine(f) }))
    : r.value.map((f) => {
        const g = toGovernedFrame(f);
        if (g.kind === 'approval' && resolvedApprovals[g.requestId] !== undefined) {
          return { ...g, resolved: resolvedApprovals[g.requestId] };
        }
        return g;
      });
  return {
    status: 'ready',
    rawMode,
    frames,
    onRespond: state.actions.respondApproval,
    toggleRaw: state.actions.toggleRaw,
  };
}

/** The `raw` escape lives on the always-visible chat pane (D85). It is a stateful
 *  toggle — brass/pressed when the unfiltered loop is showing (P5 feedback). */
function RawToggle({ on, onToggle }: { on: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <Button variant={on ? 'primary' : 'tertiary'} size="sm" aria-pressed={on} onClick={onToggle}>
      raw
    </Button>
  );
}

function ChatView({ vm }: { vm: ChatVm; host: PanelHostApi }): React.JSX.Element {
  const title = vm.status === 'ready' && vm.rawMode ? 'Chat · raw' : 'Chat';
  const actions =
    vm.status === 'ready' ? <RawToggle on={vm.rawMode} onToggle={vm.toggleRaw} /> : undefined;
  return (
    <Pane title={title} actions={actions}>
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ready' && vm.frames.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          title="No conversation yet"
          description="Turns appear here as you drive the agent."
        />
      )}
      {vm.status === 'ready' && vm.frames.length > 0 && (
        <Transcript frames={vm.frames} onRespond={vm.onRespond} label="Conversation" />
      )}
    </Pane>
  );
}

export const chatPanel: PanelDefinition<ChatVm, ConsoleState> = {
  id: 'conversation',
  displayName: 'Chat',
  render: ChatView,
  selectVm: selectChatVm,
};
