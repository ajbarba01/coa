// Archived from packages/core/src/kernel.ts — the ChangeKernel facade over the pin/rewind
// surface, removed with it. `this.root` (from `ChangeKernelOptions.root`, defaulting to
// `process.cwd()`) went too: the rewind delegate was its only reader. `checkpoint()` and
// `listTimeline()` stayed live on the kernel.

  pin(id: string): void {
    this.timeline.pin(id);
  }

  unpin(id: string): void {
    this.timeline.unpin(id);
  }

  /** Scoped rewind: a git pathspec re-materialization (working tree only — D97). */
  rewind(scope: { source: string; pathspecs: string[] }): void {
    rewindPathspec(this.root, scope.source, scope.pathspecs);
  }

  /** The retention floor (compaction safety, D94). */
  retentionFloor(consumerCursors: number[]): number {
    return this.timeline.retentionFloor(consumerCursors);
  }
