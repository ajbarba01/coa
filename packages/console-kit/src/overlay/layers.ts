import { useEffect, useRef } from 'react';

/** The dismiss-layer stack: every dismissible surface (modal, dropdown, mode)
 *  registers while open; Escape closes ONLY the topmost layer. One global
 *  listener owns the key, so layers never race each other. */
interface Layer {
  id: number;
  close: () => void;
}

const stack: Layer[] = [];
let nextId = 0;
let listening = false;

function ensureListener(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = stack.at(-1);
    if (!top) return;
    e.preventDefault();
    e.stopPropagation();
    top.close();
  });
}

/** Dismiss when a pointer goes down outside the ref'd element(s) (the industry
 *  standard for menus/dropdowns; dialogs use a guarded scrim instead). Accepts
 *  several refs so a portaled menu still counts as "inside" its trigger. */
export function useClickAway(
  refs: React.RefObject<HTMLElement | null> | React.RefObject<HTMLElement | null>[],
  onAway: () => void,
): void {
  const awayRef = useRef(onAway);
  awayRef.current = onAway;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  useEffect(() => {
    const handle = (e: PointerEvent): void => {
      const list = Array.isArray(refsRef.current) ? refsRef.current : [refsRef.current];
      const mounted = list.filter((r) => r.current !== null);
      if (mounted.length === 0) return;
      if (!mounted.some((r) => r.current?.contains(e.target as Node))) awayRef.current();
    };
    document.addEventListener('pointerdown', handle);
    return () => document.removeEventListener('pointerdown', handle);
  }, []);
}

/** Whether any dismiss layer is currently open. The host's global keymap reads
 *  this so a fallback Escape action (e.g. stop-the-running-turn) fires only
 *  when the stack has nothing left to dismiss — Escape's one authority stays
 *  the stack; the fallback is what Escape means when the stack is empty. */
export function hasOpenLayers(): boolean {
  return stack.length > 0;
}

/* ------------------------- the one-open-menu rule ------------------------- */

/** The single open popover/menu, app-wide. Two open menus is never a state a
 *  desktop app shows (the industry rule): opening one closes the other, from
 *  whatever component either lives in. */
let openPopover: { id: number; close: () => void; contains: (node: Node) => boolean } | null = null;
let popoverSeq = 0;
let popoverListening = false;

function ensurePopoverListener(): void {
  if (popoverListening) return;
  popoverListening = true;
  // A right-click nobody claims dismisses the open menu (Base UI's outside-press only
  // watches the primary button). The decision is DEFERRED past the dispatch: a claimer
  // (a row's context menu, the edit menu) marks the event with preventDefault, and the
  // deferral makes that visible here whatever order the window listeners ran in.
  window.addEventListener('contextmenu', (e) => {
    setTimeout(() => {
      if (!e.defaultPrevented) openPopover?.close();
    }, 0);
  });
}

export interface ExclusivePopoverOptions {
  /** The menu's own DOM (its portaled popup included) — what a LATER menu tests to
   *  learn it was invoked from inside this one. */
  rootRef?: React.RefObject<HTMLElement | null>;
  /** The node this menu was invoked on (a right-click's target). When the OPEN menu
   *  contains it, this menu is a SUB-LAYER — a context menu on the host's own search
   *  field — so the host stays open underneath instead of being replaced. */
  invokedOn?: Node | undefined;
}

/** Register a popover/menu while open: opening it closes whichever menu was open
 *  before it, anywhere in the app. Every kit popover carries this; a bespoke menu
 *  joins by calling it. */
export function useExclusivePopover(
  active: boolean,
  onClose: () => void,
  options?: ExclusivePopoverOptions,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!active) return;
    ensurePopoverListener();
    const opts = optionsRef.current;
    const self = {
      id: popoverSeq++,
      close: () => closeRef.current(),
      contains: (node: Node) => opts?.rootRef?.current?.contains(node) ?? false,
    };
    // A sub-layer never takes the slot: its host keeps owning "the open menu", so
    // closing the sub-layer leaves the host exactly where it was.
    const nested =
      openPopover !== null && opts?.invokedOn !== undefined && openPopover.contains(opts.invokedOn);
    if (nested) return;
    if (openPopover !== null) openPopover.close();
    openPopover = self;
    return () => {
      if (openPopover !== null && openPopover.id === self.id) openPopover = null;
    };
  }, [active]);
}

/** Register `onDismiss` as an Escape layer while `active` is true. Layers pop
 *  in reverse open order — a modal over search mode closes before the search. */
export function useDismissLayer(active: boolean, onDismiss: () => void): void {
  const closeRef = useRef(onDismiss);
  closeRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    ensureListener();
    const layer: Layer = { id: nextId++, close: () => closeRef.current() };
    stack.push(layer);
    return () => {
      const i = stack.findIndex((l) => l.id === layer.id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
