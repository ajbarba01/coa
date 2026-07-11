import { Button } from '../actions/Button.js';
import { ModalShell } from '../overlay/ModalShell.js';
import { Kbd, type Keybind } from './Kbd.js';

/** The quick shortcuts reference: the keybind registry rendered as a grouped
 *  card. It takes the table as a prop — one registry drives dispatch AND this
 *  UI, so a bind can't exist without being discoverable. */
export function ShortcutsOverlay({
  keybinds,
  onClose,
}: {
  keybinds: Keybind[];
  onClose: () => void;
}): React.JSX.Element {
  const groups = [...new Set(keybinds.map((k) => k.group))];
  return (
    <ModalShell open onClose={onClose} aria-label="keyboard shortcuts" className="w-96 pb-2">
      <div className="flex items-center border-b border-s3 px-4 py-2.5 text-caps tracking-[0.07em] text-s7 uppercase">
        keyboard shortcuts
        <Button
          variant="ghost"
          icon
          aria-label="close shortcuts"
          onClick={onClose}
          className="ml-auto h-6 w-6 text-body tracking-normal"
        >
          ✕
        </Button>
      </div>
      {groups.map((g) => (
        <div key={g} className="pt-2.5">
          <div className="px-4 pb-0.5 text-caps tracking-[0.07em] text-s6 uppercase">{g}</div>
          {keybinds
            .filter((k) => k.group === g)
            .map((k) => (
              <div key={k.label} className="flex items-center px-4 py-[5px] text-sec text-s10">
                {k.label}
                <span className="ml-auto flex gap-1">
                  {k.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
        </div>
      ))}
    </ModalShell>
  );
}
