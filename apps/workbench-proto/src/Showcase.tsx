import {
  Button,
  CapsLabel,
  Kbd,
  MenuCard,
  MenuItem,
  PopoverCard,
  Select,
  StatusDot,
  StepSlider,
  Toggle,
  cx,
} from '@coa/console-kit';
import { useState } from 'react';
import { Gallery } from './chat/Gallery.js';

/** The showcase: the living spec, two pages. `kit` is every primitive, every
 *  state; `conversation` is the transcript's whole surface vocabulary
 *  (chat/Gallery). Feedback here hardens what graduates. */
export function Showcase(): React.JSX.Element {
  const [page, setPage] = useState<'kit' | 'conversation'>('conversation');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-s3 px-8 py-1.5">
        {(['conversation', 'kit'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPage(p)}
            className={cx(
              'slip cursor-pointer rounded-r2 px-2.5 py-1 text-[12px]',
              p === page ? 'bg-s3 text-s12' : 'text-s9 hover:text-s11',
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {page === 'conversation' ? (
          <Gallery />
        ) : (
          <div className="mx-auto flex max-w-[860px] flex-col gap-10 px-8 py-8">
            <Ramp />
            <StateColors />
            <Type />
            <Buttons />
            <Controls />
            <Inputs />
            <Cards />
            <TabsSpec />
            <Rules />
            <Motion />
            <ScrollSpec />
          </div>
        )}
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
    <Section
      title="sand ramp"
      note="radix sand dark · steps 7–12 lifted one step for contrast (maintainer call)"
    >
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
          <span className="text-body font-semibold text-s12">
            Primary / active — text-body semibold s12
          </span>
          <Cap>headings, active tab, root agent</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-body text-s11">Body — text-body s11</span>
          <Cap>transcript text, messages</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-sec text-s10">Secondary — text-sec s10</span>
          <Cap>nav rows, session rows, list items</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-code text-s10">mono content — text-code s10</span>
          <Cap>commands, paths, diffs</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-meta text-s8">mono meta — text-meta s8</span>
          <Cap>costs, counts, recency, hints</Cap>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-caps tracking-[0.07em] text-s7 uppercase">
            section header — text-caps s7
          </span>
          <Cap>sidebar/browser groups</Cap>
        </div>
      </div>
    </Section>
  );
}

/* ---------- buttons ---------- */

function Buttons(): React.JSX.Element {
  return (
    <Section
      title="buttons"
      note="hover = base 140ms · press = swift 80ms scale .97/.95 · disabled = no hover"
    >
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
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/* ---------- controls ---------- */

const SPECIMEN_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type SpecimenEffort = (typeof SPECIMEN_EFFORTS)[number];

function Controls(): React.JSX.Element {
  const [onA, setOnA] = useState(false);
  const [onB, setOnB] = useState(true);
  const [theme, setTheme] = useState('sand dark');
  const [effort, setEffort] = useState<SpecimenEffort>('high');
  const [chipOpen, setChipOpen] = useState(false);
  return (
    <Section
      title="controls"
      note="toggle: neutral on-fill (blue stays running-only) · slider: named stops · selection is a `current` marker"
    >
      <div className="flex flex-col gap-5">
        <Row label="toggle — off / on / disabled off / disabled on">
          <Toggle on={onA} onChange={setOnA} aria-label="toggle specimen" />
          <Toggle on={onB} onChange={setOnB} aria-label="toggle specimen b" />
          <Toggle on={false} onChange={() => {}} disabled aria-label="disabled off" />
          <Toggle on onChange={() => {}} disabled aria-label="disabled on" />
          <Cap>+ disabled ×2</Cap>
        </Row>

        <Row label="select — combobox chip; the popup wears the menu surface">
          <Select
            options={['sand dark', 'sand light', 'system']}
            value={theme}
            onChange={setTheme}
            aria-label="theme specimen"
          />
        </Row>

        <Row label="step slider — drag / click / arrows / home / end; boxy thumb">
          <div className="w-40">
            <StepSlider
              stops={SPECIMEN_EFFORTS}
              value={effort}
              onChange={setEffort}
              aria-label="effort specimen"
            />
          </div>
          <Cap>{effort}</Cap>
        </Row>

        <Row label="popover chip — anchored card; escape closes topmost-only, outside-press closes">
          <PopoverCard
            open={chipOpen}
            onOpenChange={setChipOpen}
            className="w-44"
            trigger={
              <button
                type="button"
                className={cx(
                  'slip cursor-pointer rounded-r2 px-2 py-1 font-mono text-meta',
                  chipOpen ? 'bg-s3 text-s11' : 'text-s9 hover:bg-s3 hover:text-s11',
                )}
              >
                fable-5 · high
              </button>
            }
          >
            <CapsLabel>specimen</CapsLabel>
            <MenuItem selected>selected row</MenuItem>
            <MenuItem>option row</MenuItem>
            <MenuItem disabled>disabled row</MenuItem>
          </PopoverCard>
        </Row>

        <Row label="kbd — every named shortcut wears the chip">
          <Kbd>ctrl</Kbd>
          <Kbd>k</Kbd>
          <Cap>chords render as adjacent chips</Cap>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- inputs ---------- */

function Inputs(): React.JSX.Element {
  return (
    <Section title="inputs" note="focus = border steps up one; never a glow ring on this substrate">
      <div className="flex flex-col gap-4">
        <Row label="bare line — composer body, picker rows">
          <input
            placeholder="Message builder…"
            className="w-72 border-b border-s3 bg-transparent px-1 py-1.5 text-[13px] text-s11 outline-none placeholder:text-s6 focus:border-s5"
          />
        </Row>
        <Row label="boxed — the session search; s3 ground, s5→s6 focus">
          <div className="flex w-80 items-center gap-2.5 rounded-[7px] border border-s5 bg-s3 px-3 py-1.5 focus-within:border-s6">
            <span className="text-[15px] text-s8">⌕</span>
            <input
              placeholder="search sessions…"
              className="flex-1 bg-transparent text-[13px] text-s11 outline-none placeholder:text-s7"
            />
          </div>
        </Row>
        <Row label="in-card — picker search rows, hairline separated">
          <div className="w-64 overflow-hidden rounded-r3 border border-s5 bg-s3">
            <div className="px-3 py-1.5 text-[12px] text-s9">a result row</div>
            <div className="flex items-center gap-2 border-t border-s5 px-3 py-1.5">
              <span className="text-[13px] text-s7">⌕</span>
              <input
                placeholder="find hud…"
                className="flex-1 bg-transparent text-[12px] text-s11 outline-none placeholder:text-s7"
              />
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
    <Section
      title="cards & overlays"
      note="grounds: s2 on canvas · s3 floating · borders s4/s5 · shadow only when floating"
    >
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <div className="mb-1.5 font-mono text-[10px] text-s7">surface card (in-flow, s2/s4)</div>
          <div className="w-64 rounded-r2 border border-s4 bg-s2 px-3 py-2.5 text-[12px] text-s10">
            sits in the transcript flow — no shadow, it isn&apos;t floating
          </div>
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] text-s7">
            popover card (floating, s3/s5 + shadow)
          </div>
          <MenuCard className="w-44">
            <MenuItem selected>selected</MenuItem>
            <MenuItem>option</MenuItem>
            <MenuItem disabled>disabled</MenuItem>
          </MenuCard>
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] text-s7">
            modal (centered, s2/s5 + heavy shadow + scrim)
          </div>
          <div className="w-64 overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
            <div className="border-b border-s3 px-4 py-2 text-[10px] tracking-[0.07em] text-s7 uppercase">
              projects
            </div>
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
    <Section
      title="session tabs"
      note="active merges with the canvas + inset underline; the strip hairline breaks under it"
    >
      <div className="overflow-hidden rounded-r2 border border-s5">
        <div className="flex h-9 items-stretch border-b border-s3 bg-s2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setOn(t.id)}
              className={cx(
                'slip relative flex cursor-pointer items-center gap-2 px-4 text-[12px]',
                t.id === on
                  ? 'bg-s1 text-s12 shadow-[0_1px_0_var(--color-s1)]'
                  : 'text-s9 hover:text-s11',
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
    <Section
      title="slipstream"
      note="swift 80 · base 140 · move 200 · enter 180 · expo-out · ≤12px travel · never bouncy"
    >
      <div className="flex items-center gap-6">
        <Button>feel hover + press</Button>
        <button
          type="button"
          onClick={() => setKey((k) => k + 1)}
          className="slip cursor-pointer font-mono text-[10.5px] text-s9 hover:text-s11"
        >
          replay entrance ↻
        </button>
        <div
          key={key}
          className="slip-enter rounded-r2 border border-s4 bg-s2 px-3 py-2 text-[12px] text-s10"
        >
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
