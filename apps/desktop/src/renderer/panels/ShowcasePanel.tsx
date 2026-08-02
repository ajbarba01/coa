import { Button } from '@coa/console-kit';
import { Transcript } from '@coa/console-transcript';
import { PaneOverlayProvider, usePaneOverlay } from '@coa/console-kit';
import type { TranscriptFrame } from '@coa/console-transcript';
import { Family, Row } from './showcase/Specimen.js';
import { KitSpecimens } from './showcase/KitSpecimens.js';
import { SetRow } from './resolvedSet.js';

function PaneOverlayDemoContent(): React.JSX.Element {
  const overlay = usePaneOverlay();
  return (
    <Button
      variant="outline"
      onClick={() =>
        overlay?.open(<p className="text-s9">Confined to this pane, never the window.</p>, 'Detail')
      }
    >
      Open in Pane
    </Button>
  );
}

function PaneOverlayDemo(): React.JSX.Element {
  return (
    <div className="h-40 w-72 rounded-r3 border border-s4 bg-s2 p-3">
      <PaneOverlayProvider>
        <PaneOverlayDemoContent />
      </PaneOverlayProvider>
    </div>
  );
}

function OverlaysSection(): React.JSX.Element {
  return (
    <Family name="Overlays">
      <Row label="PaneOverlayProvider" align="start">
        <PaneOverlayDemo />
      </Row>
    </Family>
  );
}

const TRANSCRIPT_FRAMES: TranscriptFrame[] = [
  {
    id: '1',
    role: 'you',
    kind: 'text',
    text: 'Refactor the auth module to use the new token helper.',
  },
  {
    id: '2',
    role: 'agent',
    kind: 'tool-use',
    tool: 'read_file',
    input: '{ "path": "src/auth.ts" }',
  },
  {
    id: '3',
    role: 'agent',
    kind: 'tool-result',
    tool: 'read_file',
    ok: true,
    output: 'export function refreshToken(session) { /* … */ }',
  },
  {
    id: '4',
    kind: 'approval',
    requestId: 'r1',
    tool: 'write_file',
    summary: 'src/auth.ts',
    diffStat: '+42 −18',
  },
  {
    id: '5',
    kind: 'approval',
    requestId: 'r2',
    tool: 'write_file',
    summary: 'src/auth.ts',
    resolved: 'approved',
  },
  {
    id: '6',
    kind: 'deny',
    denyKind: 'cost-cap',
    reason: 'Session cost cap reached ($5.00).',
  },
  {
    id: '7',
    role: 'subagent',
    kind: 'text',
    text: 'Reviewing the diff…',
    depth: 1,
  },
  {
    id: '8',
    kind: 'raw',
    text: '> agent: tool_use read_file { "path": "src/auth.ts" }',
  },
];

function DenseSection(): React.JSX.Element {
  return (
    <Family name="Dense / Viz">
      <Row label="Transcript" align="start">
        <div className="h-72 w-full max-w-2xl overflow-hidden rounded-r3 border border-s4 bg-s2">
          <Transcript frames={TRANSCRIPT_FRAMES} scrollKey="showcase-transcript" />
        </div>
      </Row>
      <Row label="Deferred">
        <span className="text-sec text-s9">
          Longform · DiffView · Graph · Timeline. The remaining P11 members, not built yet.
        </span>
      </Row>
    </Family>
  );
}

/** The four-membership vocabulary a resolved set (roles/packages today, Tasks 4/6/7's
 *  consumers tomorrow) renders through. Rows are inert like every other specimen — the
 *  hover tint and the interior focus ring (tab through the rows) come free from the row
 *  being a real button, with nothing extra to demo. */
function ResolvedSetSection(): React.JSX.Element {
  return (
    <Family name="Resolved set">
      <Row label="SetRow · membership" align="start">
        <div className="flex w-80 flex-col gap-1 rounded-r3 border border-s4 bg-s2 p-1">
          <SetRow name="Coding" description="Edits." membership="added" onToggle={() => {}} />
          <SetRow
            name="Core"
            description="The floor."
            membership="inherited"
            meta="Default"
            onToggle={() => {}}
          />
          <SetRow
            name="Research"
            description="Search."
            membership="available"
            onToggle={() => {}}
          />
          <SetRow
            name="Legacy tools"
            description="Old scripts."
            membership="excluded"
            meta="Was default"
            onToggle={() => {}}
          />
        </div>
      </Row>
    </Family>
  );
}

/** The component showcase: a static reference with no console state — nothing here drives
 *  the daemon. The kit's own members lead; the families after them come from
 *  `@coa/console-transcript`, the conversation renderer.
 *
 *  The surface furnishes NO chrome of its own: the shell's title strip already names it,
 *  the way it names every other surface. */
export function ShowcaseSurface(): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-9">
        <p className="text-sec text-s9">
          Every kit member, then the conversation renderer chat is built from. Specimens are inert
          unless the member's whole behaviour is that it appears and leaves on its own.
        </p>
        <Family name="Kit">
          <KitSpecimens />
        </Family>
        <OverlaysSection />
        <DenseSection />
        <ResolvedSetSection />
      </div>
    </div>
  );
}
