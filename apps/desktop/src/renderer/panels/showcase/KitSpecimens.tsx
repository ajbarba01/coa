import { useRef, useState } from 'react';
import {
  BrandMark,
  Button,
  CapsLabel,
  Combobox,
  type ComboboxOption,
  cx,
  DialogSearchHead,
  Icon,
  InlineMessage,
  Kbd,
  MenuCard,
  MenuItem,
  Meter,
  ModalShell,
  PaneOverlayProvider,
  PanelResize,
  PopoverCard,
  Select,
  ShortcutsOverlay,
  Spinner,
  StatusDot,
  StepSlider,
  SettingRow,
  TocRail,
  Toast,
  Toggle,
  Tooltip,
  TooltipProvider,
  useClickAway,
  useDismissLayer,
  usePaneOverlay,
  useZoom,
  WindowControls,
  ZoomProvider,
  type BrandMarkSpec,
  type Keybind,
} from '@coa/console-kit';

/** The four tones side by side: the point of the family is that each tone owns a MARK,
 *  so a reader who cannot separate the colours still reads four different states. */
function InlineMessageSpecimen(): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <InlineMessage tone="info">Syncing.</InlineMessage>
      <InlineMessage tone="success">Saved</InlineMessage>
      <InlineMessage tone="warning">Unsaved changes</InlineMessage>
      <InlineMessage tone="danger">Failed to load</InlineMessage>
    </div>
  );
}

/** Live rather than inert: a toast's whole behaviour is that it arrives and then leaves
 *  on its own, which a static specimen cannot show. */
function ToastSpecimen(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Show toast
      </Button>
      <Toast open={open} onOpenChange={setOpen} tone="success" title="Settings saved">
        Your theme preference was applied.
      </Toast>
    </>
  );
}

/** The overlay CONFINED to its own pane rather than the window — so the specimen has to
 *  supply a pane for it to be confined to, or there is nothing to demonstrate. */
function PaneOverlayInner(): React.JSX.Element {
  const overlay = usePaneOverlay();
  return (
    <Button
      variant="outline"
      onClick={() => overlay?.open(<p className="text-s9">Confined to this pane.</p>, 'Detail')}
    >
      Open in Pane
    </Button>
  );
}

function PaneOverlaySpecimen(): React.JSX.Element {
  return (
    <div className="h-40 w-72 rounded-r3 border border-s4 bg-s2 p-3">
      <PaneOverlayProvider>
        <PaneOverlayInner />
      </PaneOverlayProvider>
    </div>
  );
}

/** One kit member's living reference: a bordered block naming the registry id it
 *  answers to (the kit-coverage test keys off `data-specimen`). */
function Specimen({ id, children }: { id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section data-specimen={id} className="flex flex-col gap-2 border-b border-s3 py-4">
      <h3 className="font-mono text-caps tracking-[0.07em] text-s8 uppercase">{id}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Cap({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="font-mono text-caps text-s8">{children}</span>;
}

/** Capitalises a raw enum/prop value for display only — the value passed to the
 *  component stays the literal lowercase token; only the caption reads sentence case. */
function capFirst(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* ---------- Foundations ---------- */

function StatusDotSpecimen(): React.JSX.Element {
  return (
    <>
      {(['running', 'needs-you', 'critical', 'done', 'idle'] as const).map((status) => (
        <div key={status} className="flex items-center gap-2">
          <StatusDot status={status} size={8} />
          <Cap>{capFirst(status)}</Cap>
        </div>
      ))}
    </>
  );
}

function SpinnerSpecimen(): React.JSX.Element {
  return (
    <>
      <Spinner label="loading specimen" />
      <Cap>Reveals 120ms late · reduced-motion pulses instead of spinning</Cap>
    </>
  );
}

const SQUARE_MARK: BrandMarkSpec = {
  name: 'Square provider',
  color: 'var(--color-run)',
  paths: [{ d: 'M5 5h14v14H5z' }],
};
const MONOGRAM_MARK: BrandMarkSpec = {
  name: 'No mark bundled',
  color: 'var(--color-warn)',
  monogram: 'NM',
};

function BrandMarkSpecimen(): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-2">
        <BrandMark spec={SQUARE_MARK} size={24} />
        <Cap>Path (bundled mark)</Cap>
      </div>
      <div className="flex items-center gap-2">
        <BrandMark spec={MONOGRAM_MARK} size={24} />
        <Cap>Monogram (no mark bundled)</Cap>
      </div>
      <div className="flex items-center gap-2">
        <BrandMark spec={SQUARE_MARK} size={24} muted />
        <Cap>Muted (a benched provider)</Cap>
      </div>
    </>
  );
}

function MeterSpecimen(): React.JSX.Element {
  return (
    <div className="flex w-64 flex-col gap-3">
      {(
        [
          ['quiet', 20],
          ['needs-you', 60],
          ['critical', 92],
          ['zero', 0],
        ] as const
      ).map(([label, percent]) => (
        <div key={label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <Cap>{capFirst(label)}</Cap>
            <span className="font-mono text-meta text-s8">{percent}%</span>
          </div>
          <Meter percent={percent} aria-label={`${label} specimen`} />
        </div>
      ))}
    </div>
  );
}

function IconSpecimen(): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-2">
        <Icon name="copy" size="sm" />
        <Cap>Sm · decorative</Cap>
      </div>
      <div className="flex items-center gap-2">
        <Icon name="settings" size="md" />
        <Cap>Md · decorative</Cap>
      </div>
      <div className="flex items-center gap-2">
        <Icon name="close" label="Close" />
        <Cap>Labelled (icon-only control)</Cap>
      </div>
    </>
  );
}

/* ---------- Overlays seams (hooks) ---------- */

function DismissLayerDemo(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useDismissLayer(open, () => setOpen(false));
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Registered (press esc)' : 'Register a Dismiss Layer'}
      </Button>
      {open && (
        <div className="rounded-r2 border border-s5 bg-s3 px-3 py-1.5 font-mono text-code text-s10">
          Active, escape closes only this layer.
        </div>
      )}
    </div>
  );
}

function UseDismissLayerSpecimen(): React.JSX.Element {
  return <DismissLayerDemo />;
}

function ClickAwayDemo(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  return (
    <div ref={ref} className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Mounted (click away)' : 'Mount a Click-Away Ref'}
      </Button>
      {open && (
        <div className="rounded-r2 border border-s5 bg-s3 px-3 py-1.5 font-mono text-code text-s10">
          Mounted, a pointerdown outside this block closes it.
        </div>
      )}
    </div>
  );
}

function UseClickAwaySpecimen(): React.JSX.Element {
  return <ClickAwayDemo />;
}

function ZoomReading(): React.JSX.Element {
  const zoom = useZoom();
  return <span className="font-mono text-code text-s10">useZoom() → {zoom}</span>;
}

function ZoomSpecimen(): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-2">
        <ZoomReading />
        <Cap>Default (no provider)</Cap>
      </div>
      <ZoomProvider value={1.25}>
        <div className="flex items-center gap-2">
          <ZoomReading />
          <Cap>Provided factor (CSS-zoom host)</Cap>
        </div>
      </ZoomProvider>
    </>
  );
}

/* ---------- Actions ---------- */

function ButtonSpecimen(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {(['primary', 'quiet', 'outline', 'block', 'ghost', 'text'] as const).map((variant) => (
          <Button key={variant} variant={variant}>
            {capFirst(variant)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button variant="primary" icon aria-label="send">
          ↑
        </Button>
      </div>
    </div>
  );
}

/* ---------- Chrome ---------- */

function WindowControlsSpecimen(): React.JSX.Element {
  const noop = (): void => {};
  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <WindowControls
          isMaximized={false}
          onMinimize={noop}
          onToggleMaximize={noop}
          onClose={noop}
        />
        <Cap>Windowed</Cap>
      </div>
      <div className="flex flex-col items-start gap-1">
        <WindowControls isMaximized onMinimize={noop} onToggleMaximize={noop} onClose={noop} />
        <Cap>Maximized (restore glyph)</Cap>
      </div>
    </>
  );
}

/* ---------- Overlays / menus ---------- */

function MenuCardSpecimen(): React.JSX.Element {
  return (
    <MenuCard className="w-44">
      <MenuItem selected>Selected row</MenuItem>
      <MenuItem>Option row</MenuItem>
    </MenuCard>
  );
}

function MenuItemSpecimen(): React.JSX.Element {
  return (
    <MenuCard className="w-44">
      <MenuItem>Default</MenuItem>
      <MenuItem selected>Selected</MenuItem>
      <MenuItem disabled>Disabled</MenuItem>
    </MenuCard>
  );
}

function CapsLabelSpecimen(): React.JSX.Element {
  return (
    <MenuCard className="w-44">
      <CapsLabel>Section</CapsLabel>
      <MenuItem>Row under it</MenuItem>
    </MenuCard>
  );
}

function PopoverCardSpecimen(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      className="w-44"
      trigger={
        <button
          type="button"
          className={cx(
            'slip cursor-pointer rounded-r2 px-2 py-1 font-mono text-meta',
            open ? 'bg-s3 text-s11' : 'text-s9 hover:bg-s3 hover:text-s11',
          )}
        >
          fable-5 · high
        </button>
      }
    >
      <CapsLabel>Specimen</CapsLabel>
      <MenuItem selected>Selected row</MenuItem>
      <MenuItem>Option row</MenuItem>
    </PopoverCard>
  );
}

function TooltipSpecimen(): React.JSX.Element {
  return (
    <>
      <Tooltip label="Search sessions" keys={['ctrl', 'p']}>
        <button
          type="button"
          aria-label="search sessions"
          className="slip cursor-pointer rounded-r2 px-2 py-1 text-icon text-s8 hover:bg-s3 hover:text-s10"
        >
          ⌕
        </button>
      </Tooltip>
      <Tooltip label="Settings">
        <button
          type="button"
          aria-label="settings"
          className="slip cursor-pointer rounded-r2 px-2 py-1 text-icon text-s8 hover:bg-s3 hover:text-s10"
        >
          ⚙
        </button>
      </Tooltip>
      <Cap>Hover or focus to open · 600ms delay, instant in the warm window</Cap>
    </>
  );
}

/* ---------- Inputs ---------- */

function SelectSpecimen(): React.JSX.Element {
  const [theme, setTheme] = useState('sand dark');
  return (
    <Select
      options={['sand dark', 'sand light', 'system']}
      value={theme}
      onChange={setTheme}
      aria-label="theme specimen"
    />
  );
}

const COMBOBOX_OPTIONS: ComboboxOption[] = [
  { value: 'opus-5', label: 'Claude · Opus 5', group: 'Claude Code' },
  { value: 'sonnet-5', label: 'Claude · Sonnet 5', group: 'Claude Code' },
  { value: 'ds-v4', label: 'DeepSeek · V4 Pro', group: 'coa scaffold' },
];

function ComboboxSpecimen(): React.JSX.Element {
  const [model, setModel] = useState('sonnet-5');
  return (
    <>
      <Combobox
        options={COMBOBOX_OPTIONS}
        value={model}
        onChange={setModel}
        placeholder="Filter models…"
        aria-label="model specimen"
      />
      <Combobox
        options={COMBOBOX_OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="disabled model specimen"
        disabled
      />
      <Cap>
        Click to open · type to filter (label or group) · an unmatched query reads "No match" ·
        second chip is disabled
      </Cap>
    </>
  );
}

function ToggleSpecimen(): React.JSX.Element {
  const [onA, setOnA] = useState(false);
  const [onB, setOnB] = useState(true);
  return (
    <>
      <Toggle on={onA} onChange={setOnA} aria-label="toggle off specimen" />
      <Toggle on={onB} onChange={setOnB} aria-label="toggle on specimen" />
      <Toggle on={false} onChange={() => {}} disabled aria-label="disabled off specimen" />
      <Toggle on onChange={() => {}} disabled aria-label="disabled on specimen" />
    </>
  );
}

const SPECIMEN_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type SpecimenEffort = (typeof SPECIMEN_EFFORTS)[number];

function StepSliderSpecimen(): React.JSX.Element {
  const [effort, setEffort] = useState<SpecimenEffort>('high');
  return (
    <div className="flex w-48 items-center gap-3">
      <StepSlider
        stops={SPECIMEN_EFFORTS}
        value={effort}
        onChange={setEffort}
        aria-label="effort specimen"
      />
      <Cap>{capFirst(effort)}</Cap>
    </div>
  );
}

/* ---------- Layout ---------- */

function PanelResizeSpecimen(): React.JSX.Element {
  const [width, setWidth] = useState(120);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="flex h-16 items-stretch">
      <div className="flex items-center bg-s2 px-2 font-mono text-meta text-s7" style={{ width }}>
        Panel
      </div>
      <PanelResize
        onDrag={(x) => setWidth(Math.max(60, Math.min(220, x)))}
        onReset={() => setWidth(120)}
        onActiveChange={setDragging}
      />
      <div className="flex flex-1 items-center bg-s1 px-2 font-mono text-meta text-s7">
        {dragging ? 'Dragging' : 'Idle'} · double-click resets
      </div>
    </div>
  );
}

function ModalShellSpecimen(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open Modal
      </Button>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        aria-label="specimen dialog"
        className="w-72"
      >
        <div className="border-b border-s3 px-4 py-2 text-caps tracking-[0.07em] text-s7 uppercase">
          specimen
        </div>
        <div className="px-4 py-3 text-sec text-s11">Scrim + heavy shadow, centered.</div>
        <div className="border-t border-s4 px-4 py-2">
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </ModalShell>
    </>
  );
}

/* ---------- Keys ---------- */

function KbdSpecimen(): React.JSX.Element {
  return (
    <>
      <Kbd>ctrl</Kbd>
      <Kbd>k</Kbd>
      <Cap>Chords render as adjacent chips</Cap>
    </>
  );
}

const SPECIMEN_KEYBINDS: Keybind[] = [
  { id: 'search', label: 'Search sessions', keys: ['ctrl', 'p'], group: 'navigation' },
  { id: 'settings', label: 'Open settings', keys: ['ctrl', ','], group: 'navigation' },
  { id: 'reserved', label: 'Reserved for later', keys: [], group: 'navigation' },
];

function ShortcutsOverlaySpecimen(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open Keyboard Shortcuts
      </Button>
      {open && <ShortcutsOverlay keybinds={SPECIMEN_KEYBINDS} onClose={() => setOpen(false)} />}
      <Cap>Closed = unmounted · read-only (no `editing` seam) · one row unbound</Cap>
    </>
  );
}

/* ---------- Settings frame ---------- */

function SettingsFrameSpecimens(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('appearance');
  const entries = [
    { id: 'appearance', title: 'Appearance' },
    { id: 'daemon', title: 'Daemon' },
  ];
  const [motion, setMotion] = useState(false);
  const [density, setDensity] = useState('compact');

  return (
    <>
      <Specimen id="DialogSearchHead">
        <div className="w-80 overflow-hidden rounded-r2 border border-s5">
          <DialogSearchHead
            value={query}
            onChange={setQuery}
            onClose={() => setQuery('')}
            placeholder="Search settings…"
          />
        </div>
      </Specimen>
      <Specimen id="TocRail">
        <div className="flex overflow-hidden rounded-r2 border border-s5">
          <TocRail entries={entries} activeId={active} onJump={setActive} />
          <div className="flex w-40 items-center px-3 font-mono text-meta text-s7">
            Active tints; activeId null clears it (search mode).
          </div>
        </div>
      </Specimen>
      <Specimen id="SettingRow">
        <div className="w-80 rounded-r2 border border-s5 px-3">
          <SettingRow name="Reduce motion" desc="Collapse transitions to instant state changes.">
            <Toggle on={motion} onChange={setMotion} aria-label="reduce motion specimen" />
          </SettingRow>
          <SettingRow name="Density" desc="Row spacing across lists and transcripts.">
            <Select
              options={['compact', 'cozy']}
              value={density}
              onChange={setDensity}
              aria-label="density specimen"
            />
          </SettingRow>
        </div>
      </Specimen>
    </>
  );
}

/** Every registered kit member, one `data-specimen` section each — the living
 *  reference that grows a specimen as new members ship. */
export function KitSpecimens(): React.JSX.Element {
  return (
    <TooltipProvider>
      <div className="flex flex-col">
        <Specimen id="StatusDot">
          <StatusDotSpecimen />
        </Specimen>
        <Specimen id="Spinner">
          <SpinnerSpecimen />
        </Specimen>
        <Specimen id="BrandMark">
          <BrandMarkSpecimen />
        </Specimen>
        <Specimen id="Meter">
          <MeterSpecimen />
        </Specimen>
        <Specimen id="InlineMessage">
          <InlineMessageSpecimen />
        </Specimen>
        <Specimen id="Toast">
          <ToastSpecimen />
        </Specimen>
        <Specimen id="Icon">
          <IconSpecimen />
        </Specimen>
        <Specimen id="useDismissLayer">
          <UseDismissLayerSpecimen />
        </Specimen>
        <Specimen id="useClickAway">
          <UseClickAwaySpecimen />
        </Specimen>
        <Specimen id="ZoomProvider / useZoom">
          <ZoomSpecimen />
        </Specimen>
        <Specimen id="Button">
          <ButtonSpecimen />
        </Specimen>
        <Specimen id="WindowControls">
          <WindowControlsSpecimen />
        </Specimen>
        <Specimen id="MenuCard">
          <MenuCardSpecimen />
        </Specimen>
        <Specimen id="MenuItem">
          <MenuItemSpecimen />
        </Specimen>
        <Specimen id="CapsLabel">
          <CapsLabelSpecimen />
        </Specimen>
        <Specimen id="PopoverCard">
          <PopoverCardSpecimen />
        </Specimen>
        <Specimen id="Tooltip">
          <TooltipSpecimen />
        </Specimen>
        <Specimen id="Select">
          <SelectSpecimen />
        </Specimen>
        <Specimen id="Combobox">
          <ComboboxSpecimen />
        </Specimen>
        <Specimen id="Toggle">
          <ToggleSpecimen />
        </Specimen>
        <Specimen id="StepSlider">
          <StepSliderSpecimen />
        </Specimen>
        <Specimen id="PanelResize">
          <PanelResizeSpecimen />
        </Specimen>
        <Specimen id="PaneOverlay">
          <PaneOverlaySpecimen />
        </Specimen>
        <Specimen id="ModalShell">
          <ModalShellSpecimen />
        </Specimen>
        <Specimen id="Kbd">
          <KbdSpecimen />
        </Specimen>
        <Specimen id="ShortcutsOverlay">
          <ShortcutsOverlaySpecimen />
        </Specimen>
        <SettingsFrameSpecimens />
      </div>
    </TooltipProvider>
  );
}
