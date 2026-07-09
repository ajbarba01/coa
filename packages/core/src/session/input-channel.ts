/**
 * A push-driven `AsyncIterable<string>` that feeds a held-open backend query its
 * successive user turns (the SDK streaming-input strategy — see docs/adr/0012).
 * `push` enqueues a turn's text (an initial turn or a mid-turn steer); `close` ends
 * the stream so the query terminates after the last turn's result. One instance is
 * created per held-open query (the LiveSession's long-lived turn channel is
 * separate and is NOT what closes — the derived feed is). Backend-neutral: it
 * carries plain strings, never an SDK type, so the same feed serves any adapter
 * that consumes `AsyncIterable<string>` input.
 */
export class InputChannel implements AsyncIterable<string> {
  #queue: string[] = [];
  #waiter: ((result: IteratorResult<string>) => void) | undefined;
  #closed = false;

  /** Enqueue one user turn's text, waking a parked consumer if one is waiting. A
   *  push after {@link close} is dropped (the query is already terminating). */
  push(text: string): void {
    if (this.#closed) return;
    if (this.#waiter !== undefined) {
      const waiter = this.#waiter;
      this.#waiter = undefined;
      waiter({ value: text, done: false });
      return;
    }
    this.#queue.push(text);
  }

  /** End the stream. A parked consumer resolves `done` immediately; the backend
   *  query it feeds terminates after the last already-yielded turn's result. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#waiter !== undefined) {
      const waiter = this.#waiter;
      this.#waiter = undefined;
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: (): Promise<IteratorResult<string>> => {
        if (this.#queue.length > 0) {
          return Promise.resolve({ value: this.#queue.shift()!, done: false });
        }
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<string>>((resolve) => {
          this.#waiter = resolve;
        });
      },
    };
  }
}
