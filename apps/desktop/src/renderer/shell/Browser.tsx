import { CapsLabel, StatusDot } from '@coa/console-kit';
import { relativeTime } from '../panels/ChatPanel.js';
import type { ConsoleState } from '../panels/state.js';
import { useShell } from './store.js';

/** The search state's canvas: the real session list, filtered by the query.
 *  Sort/group tools and saved-divider groupings arrive with the conversation
 *  pass — until then the one honest ordering is recency (the list's natural
 *  order), named by the caps label. */
export function Browser({ state }: { state: ConsoleState }): React.JSX.Element {
  const query = useShell((s) => s.query);
  const setPreview = useShell((s) => s.setPreview);
  const closeSearch = useShell((s) => s.closeSearch);
  const sessions = state.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const agents = state.data.agents.status === 'ok' ? state.data.agents.value : [];
  const nowIso = new Date().toISOString();

  const agentName = (ref: string): string => agents.find((a) => a.ref === ref)?.name ?? ref;
  const q = query.trim().toLowerCase();
  const hits = sessions.filter(
    (s) =>
      !q || s.title.toLowerCase().includes(q) || agentName(s.agentRef).toLowerCase().includes(q),
  );

  const open = (id: string): void => {
    state.actions.selectSession(id);
    closeSearch();
  };

  return (
    <div
      className="slip-enter min-h-0 flex-1 overflow-y-auto px-8 pt-12 pb-4"
      onMouseLeave={() => setPreview(undefined)}
    >
      <div className="flex items-center gap-3.5 pb-3 font-mono text-meta text-s7">
        <CapsLabel className="p-0 tracking-[0.06em] normal-case">sort: recent</CapsLabel>
        <span className="ml-auto">{hits.length} sessions</span>
      </div>

      {hits.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => open(s.id)}
          onMouseEnter={() => setPreview(s.id)}
          className="slip -mx-2.5 flex w-[calc(100%+20px)] cursor-pointer items-center gap-2.5 rounded-r2 px-2.5 py-1.75 text-left text-sec text-s10 hover:bg-s2"
        >
          <StatusDot status={state.ui.runStatus[s.id] !== undefined ? 'running' : 'idle'} />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            <Highlight text={s.title} q={q} />
          </span>
          <span className="ml-auto flex flex-none gap-3.5 font-mono text-meta text-s7">
            <span>{agentName(s.agentRef)}</span>
            <span>{relativeTime(s.updatedAt, nowIso)}</span>
          </span>
        </button>
      ))}

      {hits.length === 0 && (
        <div className="pt-10 text-center text-sec text-s7">
          {sessions.length === 0 ? 'no sessions yet' : `no sessions match “${query}”`}
        </div>
      )}
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }): React.JSX.Element {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-s12">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}
