/**
 * The daemon idle scheduler. Idle pre-compute is exactly why the daemon is kept
 * resident — GENERATION regen, the fuzzy-index build, ASSEMBLY pre-build, and the
 * detection sweep all register here. The floor runs registered jobs in priority
 * order when the idle tick (`flush`) fires; `priority`/`preemptible` order the
 * queue (PD-4). The returned handle can cancel a job before it runs.
 */
export interface IdleOptions {
  priority: number;
  preemptible: boolean;
}

export interface IdleHandle {
  cancel(): void;
}

interface IdleJob {
  run: () => void;
  options: IdleOptions;
  cancelled: boolean;
}

export class IdleScheduler {
  private jobs: IdleJob[] = [];

  scheduleIdle(run: () => void, options: IdleOptions): IdleHandle {
    const job: IdleJob = { run, options, cancelled: false };
    this.jobs.push(job);
    return {
      cancel() {
        job.cancelled = true;
      },
    };
  }

  /** Run every pending, un-cancelled job once, highest priority first. */
  flush(): void {
    const due = this.jobs
      .filter((j) => !j.cancelled)
      .sort((a, b) => b.options.priority - a.options.priority);
    this.jobs = [];
    for (const job of due) job.run();
  }
}
