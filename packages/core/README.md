# @coa/core

The daemon: the M1 change-event spine plus the M3–M8 rings around it (constraints/flags, context engine,
config compiler, workbench, governance/audit, daemon orchestration) and the credential-blind auth registry.

- **Modules:** M1 Change Kernel (the spine) + M3–M8. Start at
  [`spec/M1.md`](../../docs/design/handoff/spec/M1.md); the per-module specs `M3.md`–`M8.md` sit alongside it.
  The intra-`core` ring layout is in [`REPO_LAYOUT.md`](../../docs/REPO_LAYOUT.md).
- **Public interface:** `src/index.ts`.
- **Rationale:** [`0009`](../../docs/adr/0009-single-deny-channel.md) (the single deny channel;
  [`0035`](../../docs/adr/0035-the-close-gate-is-the-only-block.md) narrows its two blocks to one),
  [`0010`](../../docs/adr/0010-append-only-conversation-log.md),
  [`0011`](../../docs/adr/0011-daemon-authoritative-live-session.md),
  [`0012`](../../docs/adr/0012-sdk-streaming-input-steering.md),
  [`0013`](../../docs/adr/0013-streaming-complete-and-delta-frames.md).

Only `spine/` (M1) is shared mutable substrate; the other rings point at it, never sideways at each other.
