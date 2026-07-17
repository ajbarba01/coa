import {
  MenuCard,
  MenuItem,
  useClickAway,
  useDismissLayer,
  useExclusivePopover,
} from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';

/**
 * The app-wide text context menu — cut/copy/paste in the kit's own skin, where a native
 * menu would wear the OS's. One instance in the shell serves every field and every text
 * selection; the ACTIONS run in main (Chromium's native editing commands on the focused
 * element), so this component never touches the clipboard itself.
 *
 * It rides the same two registries as every other menu: the Escape layer stack and the
 * one-open-menu rule — so opening it closes a row's ⋯ menu and vice versa, and a
 * right-click that lands on neither a field nor a selection stays unclaimed for the
 * registry's dismiss listener.
 */

type EditCommand = 'cut' | 'copy' | 'paste' | 'selectAll';

interface EditContext {
  x: number;
  y: number;
  /** `field`: the caret context (cut/copy/paste/select all). `selection`: read-only copy. */
  kind: 'field' | 'selection';
  /** Cut/copy need a selection — and a password field's text never leaves it. */
  canTake: boolean;
  /** The node the right-click landed on. When an open menu contains it, this menu is
   *  that menu's SUB-LAYER (editing its search field) and must not close it. */
  target: Node;
}

/** Card metrics for viewport clamping (w-44; the four-row card's height). */
const MENU_W = 176;
const MENU_H = 136;

/** Pure-ish: what an edit menu at this right-click would act on, or nothing. */
export function editContextOf(e: MouseEvent): EditContext | undefined {
  const t = e.target;
  const editable =
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable);
  if (editable) {
    const field = t as HTMLInputElement | HTMLTextAreaElement;
    const hasSelection =
      typeof field.selectionStart === 'number'
        ? field.selectionStart !== field.selectionEnd
        : (window.getSelection()?.toString() ?? '') !== '';
    const secret = t instanceof HTMLInputElement && t.type === 'password';
    return {
      x: e.clientX,
      y: e.clientY,
      kind: 'field',
      canTake: hasSelection && !secret,
      target: t,
    };
  }
  if ((window.getSelection()?.toString().trim() ?? '') !== '' && t instanceof Node) {
    return { x: e.clientX, y: e.clientY, kind: 'selection', canTake: true, target: t };
  }
  return undefined;
}

export function EditMenu(): React.JSX.Element | null {
  const [ctx, setCtx] = useState<EditContext>();
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (): void => setCtx(undefined);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent): void => {
      // A right-click on the menu itself neither repositions nor closes it — menus
      // don't get menus. preventDefault marks the event CLAIMED, which is what keeps
      // the registry's deferred dismiss from firing (order-independent).
      if (
        menuRef.current !== null &&
        e.target instanceof Node &&
        menuRef.current.contains(e.target)
      ) {
        e.preventDefault();
        return;
      }
      const next = editContextOf(e);
      if (next === undefined) return; // unclaimed — the registry's dismiss owns it
      e.preventDefault();
      setCtx(next);
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  const open = ctx !== undefined;
  useDismissLayer(open, close);
  // Exclusive like any menu — except invoked INSIDE the open menu (its search field),
  // where it stacks above as a sub-layer and the host stays open.
  useExclusivePopover(open, close, { invokedOn: ctx?.target });
  useClickAway(menuRef, close);

  if (ctx === undefined) return null;

  const run = (command: EditCommand): void => {
    close();
    const bridge = (window as { coa?: Window['coa'] }).coa;
    void bridge?.editCommand({ command });
  };

  // The chord each line answers to — the OS's own, worn in the menu's trailing-marker
  // register (the same slot MenuItem's `current` uses).
  const mod = (window as { coa?: Window['coa'] }).coa?.platform === 'darwin' ? '⌘' : 'ctrl+';
  const chord = (key: string): React.JSX.Element => (
    <span className="ml-auto pl-4 font-mono text-caps tracking-normal text-s6">
      {mod}
      {key}
    </span>
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-(--z-context-menu)"
      style={{
        left: Math.max(0, Math.min(ctx.x, window.innerWidth - MENU_W)),
        top: Math.max(0, Math.min(ctx.y, window.innerHeight - MENU_H)),
      }}
      // Focus must stay in the field the menu acts on — a focused menu button would
      // swallow the edit command main is about to run. stopPropagation keeps the click
      // from reaching the host menu's click-away listener: choosing "paste" must not
      // unmount the very field the paste is headed for.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <MenuCard className="w-44">
        {ctx.kind === 'field' ? (
          <>
            <MenuItem disabled={!ctx.canTake} onClick={() => run('cut')}>
              cut
              {chord('x')}
            </MenuItem>
            <MenuItem disabled={!ctx.canTake} onClick={() => run('copy')}>
              copy
              {chord('c')}
            </MenuItem>
            <MenuItem onClick={() => run('paste')}>
              paste
              {chord('v')}
            </MenuItem>
            <MenuItem onClick={() => run('selectAll')}>
              select all
              {chord('a')}
            </MenuItem>
          </>
        ) : (
          <MenuItem onClick={() => run('copy')}>
            copy
            {chord('c')}
          </MenuItem>
        )}
      </MenuCard>
    </div>
  );
}
