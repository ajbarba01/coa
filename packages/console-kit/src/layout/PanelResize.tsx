import { useRef, useState } from 'react';
import { cx } from '../cx.js';
import { useZoom } from '../zoom.js';

/** A zero-width column seam: a 7px grab strip straddling the border, showing a
 *  brightened hairline on hover/drag. Double-click restores the default width.
 *  The drag runs until pointerup — collapse/reopen decisions live in onDrag,
 *  which receives the pointer's x in LAYOUT px (already divided by the zoom). */
export function PanelResize({
  onDrag,
  onReset,
  onActiveChange,
}: {
  onDrag: (layoutX: number) => void;
  onReset: () => void;
  onActiveChange?: (active: boolean) => void;
}): React.JSX.Element {
  const [active, setActive] = useState(false);
  const dragging = useRef(false);
  const zoom = useZoom();

  const setDrag = (on: boolean): void => {
    dragging.current = on;
    setActive(on);
    onActiveChange?.(on);
  };

  return (
    <div className="relative z-20 w-0 flex-none">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="resize panel"
        onPointerDown={(e) => {
          e.preventDefault();
          setDrag(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current) onDrag(e.clientX / zoom);
        }}
        onPointerUp={() => setDrag(false)}
        onDoubleClick={onReset}
        className="group absolute inset-y-0 -left-[3px] w-[7px] cursor-col-resize"
      >
        <span
          className={cx(
            'slip absolute inset-y-0 left-[3px] w-px',
            active ? 'bg-s7' : 'bg-transparent group-hover:bg-s6',
          )}
        />
      </div>
    </div>
  );
}
