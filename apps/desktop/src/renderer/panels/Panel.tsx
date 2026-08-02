import { cx } from '@coa/console-kit';

/**
 * A contained region on the console's in-flow elevation: s2 ground, s4 hairline, r3, and
 * NO shadow (docs/UI.md, elevation grounds). Deliberately not a card — it never floats,
 * never carries a drop shadow, is never nested, and its siblings are not forced to a
 * uniform size. A `SetRow`'s s3 inside it stays a selection tint on the ground, not a
 * second surface.
 *
 * The agent editor was the one console surface whose content sat directly on the raw
 * canvas, held apart by gap alone; every other surface (the composer's rect, the usage
 * tiles, auth's rows) gives its content an edge. This is what closes that gap, and it is
 * also what bounds a reflow: a row appearing in one panel grows that panel instead of
 * shoving everything below it down the page.
 *
 * App-level rather than a kit member, on the `fields.tsx` / `resolvedSet.tsx` /
 * `RowMenu.tsx` precedent: it earns promotion once a surface outside this one needs it.
 */
export interface PanelProps {
  label: string;
  /** The trailing fact in the header. A node, not just a number, so a compound count
   *  ("6 tools") wears the same header rather than hand-writing its own markup. Omit it
   *  entirely when a count would mislead — Reach's permissive floor is the live case. */
  count?: React.ReactNode;
  /** Rendered beneath the body on its own hairline. The `AddPicker` trigger's home:
   *  adding to a set is an action ON the panel, not another row in it. */
  footer?: React.ReactNode;
  /** `rows` for a row list, whose rows carry their own padding; `prose` for free content
   *  that needs the panel to supply its own. */
  density?: 'rows' | 'prose';
  children?: React.ReactNode;
}

export function Panel({
  label,
  count,
  footer,
  density = 'rows',
  children,
}: PanelProps): React.JSX.Element {
  return (
    <div
      role="region"
      aria-label={label}
      className="flex flex-col overflow-hidden rounded-r3 border border-s4 bg-s2"
    >
      <div className="flex items-center justify-between gap-2.5 border-b border-s4 px-3 py-1.5">
        {/* `text-code`, from the CURRENT ramp. `text-code` — what the loose section
            headers used — resolves only in the retired kit's type scale, and reaching
            across for a size is the same leak that broke the agent name's two faces. */}
        <span className="text-code text-s9">{label}</span>
        {count !== undefined && <span className="font-mono text-meta text-s7">{count}</span>}
      </div>
      {children !== undefined && (
        <div className={cx(density === 'rows' ? 'p-1.5' : 'px-3 py-2.5')}>{children}</div>
      )}
      {footer !== undefined && (
        <div data-panel-footer className="border-t border-s4 p-1.5">
          {footer}
        </div>
      )}
    </div>
  );
}
