import { Button, StatusDot, cx } from '@coa/console-kit';
import { useState } from 'react';

/** The kit showcase: every primitive, every state, on the record.
 *  Feedback here hardens what graduates into @coa/console-kit. */
export function Showcase(): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-10 px-8 py-8">
        <Ramp />
        <StateColors />
        <Type />
        <Buttons />
        <Inputs />
        <Cards />
        <TabsSpec />
        <ChatMolecules />
        <Rules />
        <Motion />
        <ScrollSpec />
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3 border-b border-s3 pb-2">
        <h2 className="text-[13px] font-semibold text-s12">{title}</h2>
        {note && <span className="font-mono text-[10.5px] text-s8">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Cap({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="font-mono text-[10px] text-s8">{children}</span>;
}

/* ---------- color ---------- */

function Ramp(): React.JSX.Element {
  const steps = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12'];
  return (
    <Section title="sand ramp" note="radix sand dark · steps 7–12 lifted one step for contrast (maintainer call)">
      <div className="flex overflow-hidden rounded-r2 border border-s5">
        {steps.map((s) => (
          <div key={s} className="flex-1">
            <div className="h-14" style={{ background: `var(--color-${s})` }} />
            <div className="bg-s2 py-1 text-center font-mono text-[9.5px] text-s9">{s}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 max-w-[70ch] text-[11.5px] leading-relaxed text-s9">
        1–2 grounds · 3–5 raised/hover/active · 3–5 borders (structure) · 6 strong border · 7–8
        muted glyphs · 9–10 secondary text · 11 body · 12 primary/active text.
      </p>
    </Section>
  );
}

function StateColors(): React.JSX.Element {
  return (
    <Section title="state vocabulary" note="the indicator law: state is a dot, never a word">
      <div className="flex flex-wrap gap-6">
        {(
          [
            ['running', 'run — blue, the agent is going'],
            ['needs-you', 'warn — a gate waits on you'],
            ['critical', 'crit — flag/deny territory'],
            ['done', 'ok — done / clean / success'],
            ['idle', 'idle — nothing to say'],
          ] as const
        ).map(([status, label]) => (
          <div key={status} className="flex items-center gap-2.5">
            <StatusDot status={status} size={8} />
            <Cap>{label}</Cap>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-6">
        <span className="font-mono text-[11.5px] text-diff-add">+42 additions</span>
        <span className="font-mono text-[11.5px] text-diff-del">−11 deletions</span>
        <span className="font-mono text-[11.5px] text-crit">⚑1 critical flag</span>
        <span className="font-mono text-[11.5px] text-warn">● needs you</span>
      </div>
    </Section>
  );
}

/* ---------- type ---------- */

function Type(): React.JSX.Element {
  return (
    <Section title="type scale" note="system-ui + mono · one scale, no drift">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-4">
          <span className="text-[13px] font-semibold text-s12">Primary / active — 13 semibold s12</span>
          <Cap>headings, active tab, root agent</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-[13px] text-s11">Body — 13 regular s11</span>
          <Cap>transcript text, messages</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-[12.5px] text-s10">Secondary — 12.5 s10</span>
          <Cap>nav rows, session rows, list items</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[11.5px] text-s10">mono content — 11.5 s10</span>
          <Cap>commands, paths, diffs</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[10.5px] text-s8">mono meta — 10.5 s8</span>
          <Cap>costs, counts, recency, hints</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-[10px] tracking-[0.07em] text-s7 uppercase">section header — 10 caps s7</span>
          <Cap>sidebar/browser groups</Cap>
        </div>
      </div>
    </Section>
  );
}

/* ---------- buttons ---------- */

function Buttons(): React.JSX.Element {
  return (
    <Section title="buttons" note="hover = base 140ms · press = swift 80ms scale .97/.95 · disabled = no hover">
      <div className="flex flex-col gap-5">
        <Row label="primary (accent) — send, start daemon, one per view at most">
          <Button variant="primary">Start daemon</Button>
          <Button variant="primary" icon aria-label="send">
            ↑
          </Button>
          <Button variant="primary" icon aria-label="send" disabled>
            ↑
          </Button>
          <Cap>+ disabled</Cap>
        </Row>

        <Row label="quiet solid — approve, confirm; the workhorse">
          <Button>Approve</Button>
          <Button disabled>Approve</Button>
          <Cap>+ disabled</Cap>
        </Row>

        <Row label="outline — deny, secondary actions">
          <Button variant="outline">Deny</Button>
          <Button variant="outline" disabled>
            Deny
          </Button>
          <Cap>+ disabled</Cap>
        </Row>

        <Row label="raised block — attach; small square utilities">
          <Button variant="block" icon aria-label="attach">
            <Paperclip />
          </Button>
        </Row>

        <Row label="ghost icon — foot buttons, window-adjacent">
          <Button variant="ghost" icon aria-label="settings">
            ⚙
          </Button>
          <Button variant="ghost" icon aria-label="theme">
            ◐
          </Button>
        </Row>

        <Row label="text button — toolbar controls, ink-only hover">
          <Button variant="text">sort: recent ▾</Button>
          <Button variant="text">group: divider ▾</Button>
        </Row>
      </div>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] text-s7">{label}</div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

function Paperclip(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/* ---------- inputs ---------- */

function Inputs(): React.JSX.Element {
  return (
    <Section title="inputs" note="focus = border steps up one; never a glow ring on this substrate">
      <div className="flex flex-col gap-4">
        <Row label="bare line — composer body, picker rows">
          <input placeholder="Message builder…" className="w-72 border-b border-s3 bg-transparent px-1 py-1.5 text-[13px] text-s11 outline-none placeholder:text-s6 focus:border-s5" />
        </Row>
        <Row label="boxed — the session search; s3 ground, s5→s6 focus">
          <div className="flex w-80 items-center gap-2.5 rounded-[7px] border border-s5 bg-s3 px-3 py-1.5 focus-within:border-s6">
            <span className="text-[15px] text-s8">⌕</span>
            <input placeholder="search sessions…" className="flex-1 bg-transparent text-[13px] text-s11 outline-none placeholder:text-s7" />
          </div>
        </Row>
        <Row label="in-card — picker search rows, hairline separated">
          <div className="w-64 overflow-hidden rounded-r3 border border-s5 bg-s3">
            <div className="px-3 py-1.5 text-[12px] text-s9">a result row</div>
            <div className="flex items-center gap-2 border-t border-s5 px-3 py-1.5">
              <span className="text-[13px] text-s7">⌕</span>
              <input placeholder="find hud…" className="flex-1 bg-transparent text-[12px] text-s11 outline-none placeholder:text-s7" />
            </div>
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- cards / overlays ---------- */

function Cards(): React.JSX.Element {
  return (
    <Section title="cards & overlays" note="grounds: s2 on canvas · s3 floating · borders s4/s5 · shadow only when floating">
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <div className="mb-1.5 font-mono text-[10px] text-s7">surface card (in-flow, s2/s4)</div>
          <div className="w-64 rounded-r2 border border-s4 bg-s2 px-3 py-2.5 text-[12px] text-s10">
            sits in the transcript flow — no shadow, it isn&apos;t floating
          </div>
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] text-s7">popover card (floating, s3/s5 + shadow)</div>
          <div className="w-44 overflow-hidden rounded-r3 border border-s5 bg-s3 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
            <div className="slip cursor-pointer bg-s4 px-3 py-1.5 text-[12px] text-s12">highlighted</div>
            <div className="slip cursor-pointer px-3 py-1.5 text-[12px] text-s9 hover:bg-s4 hover:text-s11">option</div>
            <div className="px-3 py-1.5 text-[12px] text-s6">disabled</div>
          </div>
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] text-s7">modal (centered, s2/s5 + heavy shadow + scrim)</div>
          <div className="w-64 overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
            <div className="border-b border-s3 px-4 py-2 text-[10px] tracking-[0.07em] text-s7 uppercase">projects</div>
            <div className="px-4 py-2.5 text-[12.5px] text-s11">dialog content</div>
            <div className="border-t border-s4 px-4 py-2 text-[12px] text-s8">footer action</div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ---------- tabs ---------- */

function TabsSpec(): React.JSX.Element {
  const [on, setOn] = useState('fix-pipe-test');
  const tabs = [
    { id: 'fix-pipe-test', status: 'running' as const },
    { id: 'docs-sweep', status: 'needs-you' as const },
    { id: 'refactor-m4', status: 'idle' as const },
  ];
  return (
    <Section title="session tabs" note="active merges with the canvas + inset underline; the strip hairline breaks under it">
      <div className="overflow-hidden rounded-r2 border border-s5">
        <div className="flex h-9 items-stretch border-b border-s3 bg-s2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setOn(t.id)}
              className={cx(
                'slip relative flex cursor-pointer items-center gap-2 px-4 text-[12px]',
                t.id === on ? 'bg-s1 text-s12 shadow-[0_1px_0_var(--color-s1)]' : 'text-s9 hover:text-s11',
              )}
            >
              <StatusDot status={t.status} />
              {t.id}
              {t.id === on && <span className="absolute right-3 bottom-0 left-3 h-0.5 bg-s9" />}
            </button>
          ))}
        </div>
        <div className="h-10 bg-s1" />
      </div>
    </Section>
  );
}

/* ---------- chat molecules ---------- */

function ChatMolecules(): React.JSX.Element {
  const [resolved, setResolved] = useState<undefined | 'approved' | 'denied'>(undefined);
  return (
    <Section title="chat molecules" note="the transcript's block vocabulary — every kind, resting state">
      <div className="flex flex-col gap-3.5 rounded-r2 border border-s4 bg-s1 p-5">
        <div className="max-w-[70%] self-end rounded-[6px_6px_2px_6px] bg-s3 px-3 py-2 text-[13px] text-s11">
          user message — right-aligned, raised one step
        </div>
        <div className="text-[11.5px] text-s7 italic">
          reasoning — muted italic, streams per-word, no label (the color IS the label)
        </div>
        <div className="flex items-center gap-2 py-px font-mono text-[11.5px] text-s8">
          <span className="w-3 text-center text-s7">R</span>
          <span className="text-s9">pipe-server.test.ts</span>
        </div>
        <div className="max-w-[88%] overflow-hidden rounded-r2 border border-s3 bg-s2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 font-mono text-[11.5px] text-s9">
            <span className="w-3 text-center text-s7">E</span>
            <span className="text-s11">packages/daemon/src/transport/pipe-server.ts</span>
            <span className="ml-auto"><span className="text-diff-add">+9</span> <span className="text-diff-del">−3</span></span>
          </div>
          <div className="border-t border-s3 py-1 font-mono text-[11px] leading-[1.65]">
            <div className="px-3 whitespace-pre text-s7">  async close(): Promise&lt;void&gt; {'{'}</div>
            <div className="px-3 whitespace-pre text-diff-del">-   this.server.close();</div>
            <div className="px-3 whitespace-pre text-diff-add">+   await this.drainPending();</div>
          </div>
        </div>
        <div className="max-w-[88%] text-[13px] leading-[1.55] text-s11">
          agent text — body ink, with <b className="font-semibold text-s12">bold reaching s12</b>
        </div>
        <div className="group flex items-center gap-2 py-0.5 text-[12px] text-s8">
          <span className="font-mono text-s7">⎇</span>
          <b className="font-[550] text-s9">test-writer</b>
          <StatusDot status="running" size={5} />
          <span className="font-mono text-[10.5px] text-s6">4 tools · $0.12</span>
          <span className="hidden gap-2 text-[10.5px] text-s8 group-hover:flex">
            <button type="button" className="cursor-pointer hover:text-s10">watch</button>
            <button type="button" className="cursor-pointer hover:text-s10">stop</button>
          </span>
          <Cap>← hover me</Cap>
        </div>
        <div className="max-w-[88%] rounded-r2 border border-s4 bg-s2 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] font-[550] text-s11">
            <StatusDot status={resolved ? (resolved === 'approved' ? 'done' : 'critical') : 'needs-you'} />
            Bash
            {resolved && <span className="ml-auto font-mono text-[10px] text-s7">{resolved}</span>}
          </div>
          <div className="mt-1.5 font-mono text-[11.5px] text-s10">pnpm vitest run --retry=8</div>
          <div className="mt-1 text-[11px] text-s7">retry-loop exceeds the verification budget · M3</div>
          {!resolved && (
            <div className="mt-2.5 flex items-center gap-2.5">
              <button type="button" onClick={() => setResolved('approved')} className="slip slip-press cursor-pointer rounded-r1 border border-s6 bg-s5 px-3 py-1 text-[11.5px] font-[550] text-s12 hover:bg-s6 active:scale-[0.97]">Approve</button>
              <button type="button" onClick={() => setResolved('denied')} className="slip slip-press cursor-pointer rounded-r1 border border-s4 px-3 py-1 text-[11.5px] text-s8 hover:border-s6 hover:text-s11 active:scale-[0.97]">Deny</button>
              <span className="font-mono text-[9.5px] text-s6">⏎ ⌫</span>
            </div>
          )}
        </div>
        {resolved && (
          <button type="button" onClick={() => setResolved(undefined)} className="slip self-start cursor-pointer font-mono text-[10px] text-s7 hover:text-s9">
            reset approval specimen
          </button>
        )}
      </div>
    </Section>
  );
}

/* ---------- rules ---------- */

function Rules(): React.JSX.Element {
  return (
    <Section title="hairlines" note="three weights, each with one job">
      <div className="flex flex-col gap-3">
        {(
          [
            ['s3', 'internal — separates content inside one surface (sections, card headers)'],
            ['s4', 'structural — separates surfaces (sidebar borders, modal footers)'],
            ['s5', 'floating — edges of raised cards and inputs'],
          ] as const
        ).map(([step, job]) => (
          <div key={step} className="flex items-center gap-4">
            <div className="h-px w-40" style={{ background: `var(--color-${step})` }} />
            <Cap>
              {step} — {job}
            </Cap>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- motion ---------- */

function Motion(): React.JSX.Element {
  const [key, setKey] = useState(0);
  return (
    <Section title="slipstream" note="swift 80 · base 140 · move 200 · enter 180 · expo-out · ≤12px travel · never bouncy">
      <div className="flex items-center gap-6">
        <button type="button" className="slip slip-press cursor-pointer rounded-r2 border border-s6 bg-s5 px-4 py-1.5 text-[12.5px] text-s12 hover:bg-s6 active:scale-[0.97]">
          feel hover + press
        </button>
        <button type="button" onClick={() => setKey((k) => k + 1)} className="slip cursor-pointer font-mono text-[10.5px] text-s9 hover:text-s11">
          replay entrance ↻
        </button>
        <div key={key} className="slip-enter rounded-r2 border border-s4 bg-s2 px-3 py-2 text-[12px] text-s10">
          mounts with fade + 6px rise @ 180ms
        </div>
      </div>
    </Section>
  );
}

/* ---------- scrollbar ---------- */

function ScrollSpec(): React.JSX.Element {
  return (
    <Section title="scrollbar" note="boxy, constant width, hover-revealed, s4→s5→s6">
      <div className="h-32 w-80 overflow-y-auto rounded-r2 border border-s4 bg-s1 px-4 py-2">
        {Array.from({ length: 18 }, (_, i) => (
          <div key={i} className="py-1 font-mono text-[11px] text-s8">
            scroll line {i + 1} — hover this box to reveal the thumb
          </div>
        ))}
      </div>
    </Section>
  );
}
