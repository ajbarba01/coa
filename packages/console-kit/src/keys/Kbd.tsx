/** One keybind registry drives BOTH the dispatch and the shortcuts UI, so a
 *  bind can't exist without being discoverable. The registry data lives with
 *  the app; the kit owns the vocabulary for rendering it. */
export interface Keybind {
  keys: string[];
  label: string;
  group: string;
}

/** The kbd chip — every surface that names a shortcut renders it with this. */
export function Kbd({ children }: { children: string }): React.JSX.Element {
  return (
    <kbd className="rounded-r1 border border-s4 bg-s3 px-1.5 py-0.5 font-mono text-caps leading-none tracking-normal text-s9">
      {children}
    </kbd>
  );
}
