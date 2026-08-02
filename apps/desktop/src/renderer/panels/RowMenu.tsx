import { useState } from 'react';
import { PopoverCard } from '@coa/console-kit';

/**
 * The panels' one row overflow menu — a `⋯` trigger opening a `PopoverCard` of
 * `MenuItem`s, `align="end"` unless a right-click supplies an `anchorPoint` (then
 * `start`, anchored under the cursor instead of the trigger). The third consumer
 * (`AgentsPanel`'s row menu) is what earned the extraction — `AuthPanel` and
 * `ModelEditor` each carried a private, near-identical copy before. One shell:
 * `open`/`onOpenChange` are optional, falling back to the menu's own state, so a
 * plain row (Agents) can use it uncontrolled while a row with a second way in
 * (Auth's right-click) supplies the pair itself. Clicking any item closes the
 * menu — callers don't each have to remember to.
 */
export function RowMenu({
  label,
  open: controlledOpen,
  onOpenChange,
  anchorPoint,
  children,
}: {
  label: string;
  /** Controlled pair — a row that also opens this menu on right-click owns the state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Present while the menu was opened by right-click: anchor under the cursor. */
  anchorPoint?: { x: number; y: number } | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align={anchorPoint === undefined ? 'end' : 'start'}
      anchorPoint={anchorPoint}
      className="w-44"
      trigger={
        <button
          type="button"
          aria-label={label}
          className="slip flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-r2 text-s7 hover:bg-s4 hover:text-s11"
        >
          ⋯
        </button>
      }
    >
      <div onClick={() => setOpen(false)}>{children}</div>
    </PopoverCard>
  );
}
