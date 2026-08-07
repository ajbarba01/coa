// Archived from packages/core/src/signal-bus.ts
/**
 * The minimal signal bus (D75/D83): a WAL-fed projection exposing a queryable
 * stream of events — the sensor layer for the adaptability/self-improvement
 * loops. Events follow OpenTelemetry semantic-convention naming, emitted by a
 * lightweight in-house emitter (no OTel SDK/collector in v1; an exporter is a
 * later capability). Retention is bounded (R-10) — the oldest signals drop.
 */
export interface SignalEvent {
  /** OTel-style dotted name, e.g. `coa.change`, `coa.checkpoint`. */
  name: string;
  ts: string;
  attributes: Record<string, string | number | boolean>;
}

export class SignalBus {
  private events: SignalEvent[] = [];

  constructor(private readonly capacity = 4096) {}

  record(event: SignalEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events = this.events.slice(this.events.length - this.capacity);
    }
  }

  query(predicate?: (event: SignalEvent) => boolean): SignalEvent[] {
    return predicate ? this.events.filter(predicate) : [...this.events];
  }
}
