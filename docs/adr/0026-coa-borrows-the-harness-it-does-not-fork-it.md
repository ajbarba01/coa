# 0026 — coa borrows the harness; it does not fork it

- Status: accepted
- Date: 2026-08-02

Closes a question that had been re-opened informally every time Claude Code's behaviour chafed. The
evidence is the [control ledger](../design/research/2026-08-02-claude-sdk-control-ledger.md); this
records the ruling so it stops being re-litigated.

## Context and problem

coa borrows a vendor harness (the Claude Agent SDK) to run one of its backends. Where the harness
behaves in a way coa would rather it didn't, three responses were being weighed informally: configure
around it, fork the SDK, or stop using it. "The SDK source is available" made forking sound cheap.

It is not cheap, and the premise was wrong. `sdk.mjs` is an 899 KB **wrapper**; the harness itself is a
Bun-compiled `claude` binary shipped as a per-platform optional dependency (~236 MB, one sha256 each in
`manifest.json`). System prompt text, built-in tool implementations, compaction and the subagent
machinery all live inside the binary. Forking the public repo buys the process-spawn and stdio
plumbing, and none of the behaviour anyone wants to change.

The question could not be answered by argument, because both sides rested on guesses about how much of
the loop coa could reach. So it was answered by measurement first.

## Decision drivers

- **A fork is only justified by something genuinely unreachable.** Nine stages of the loop were rated;
  **none came back `Opaque`.** Six of nine standing assumptions about the SDK's limits were false.
- **Upstream cadence.** 26.8 releases per month over the last six months (161 in six), measured from
  `npm view @anthropic-ai/claude-agent-sdk time`. A patch against minified Bun output has a shelf life
  of roughly 27 hours.
- **Integrity and licensing.** Per-platform checksums, a verified Anthropic Authenticode signature on
  the win32 binary, and an all-rights-reserved license with no redistribution grant.
- **A third path already ships.** `@coa/loop-driver` talks to models directly and is proven live for
  DeepSeek and LongCat.

## Considered options

1. **Fork the wrapper.** Cheap, and buys nothing about loop behaviour — none of it lives there.
2. **Patch the binary**, pointing `pathToClaudeCodeExecutable` at the result. The only option that
   reaches something otherwise unreachable, and the only one that fails on all three of cadence,
   integrity and licensing.
3. **Configure the harness**, using the levers the ledger found.
4. **Stop borrowing** for a given case — coa talks to the model directly.

## Decision

**coa configures the harness it borrows, and never modifies it.** Where configuration cannot reach a
behaviour, the choice is between accepting it (and labelling it honestly in the record) and not
borrowing the harness for that case — the pure-API path. There is no middle option involving a
modified binary.

This reframes "fork" as what it actually is: a choice between borrowing the harness and not using it,
rather than a third way.

## Consequences

**Good.** The question stops recurring. A recurring argument is replaced by a measured verdict with a
version stamp, so a future challenge has to bring new measurements rather than new opinions. It also
keeps coa's relationship with every vendor harness uniform — Codex and any later addition inherit the
same rule, which matters because the arc treats harnesses as borrowed capability rather than hosted
peers.

**Bad.** coa is bounded by what the harness exposes, and that boundary moves roughly 27 times a month.
The mitigation is the probe suite in `packages/adapter-claude-sdk/src/control/`: every verdict is
version-stamped and asserted, so an SDK bump fails a probe and names what expired instead of silently
invalidating a design. The suite is only as good as its upkeep, and it is offline-only — the live
probes need an account and real spend, so parts of the answer will drift before anyone notices.

---

_Last reviewed: 2026-08-02_
