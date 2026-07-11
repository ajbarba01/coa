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
