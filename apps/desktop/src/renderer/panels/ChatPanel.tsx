import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { EmptyState, InlineMessage, Pane, Skeleton, Transcript } from '@coa/console-ui';
import type { RespondFn, TranscriptFrame } from '@coa/console-ui';
import type { TurnFrame } from '@coa/console-viewmodel';
import { MessageSquare } from 'lucide-react';
import type { ConsoleState } from './state.js';

export type ChatVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rawMode: boolean; frames: TranscriptFrame[]; onRespond: RespondFn };

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

/** Pure: projects the polled turn stream into transcript frames. A later part adds the
 *  raw reprojection and approval-resolution overlay. */
export function selectChatVm(state: ConsoleState): ChatVm {
  const r = state.data.turns;
  if (r.status !== 'ok') return r;
  return {
    status: 'ready',
    rawMode: false,
    frames: r.value.map(toGovernedFrame),
    onRespond: () => {},
  };
}

function ChatView({ vm }: { vm: ChatVm; host: PanelHostApi }): React.JSX.Element {
  const title = vm.status === 'ready' && vm.rawMode ? 'Chat · raw' : 'Chat';
  return (
    <Pane title={title} className="h-full">
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
