# coa

coa runs a coding agent against your project and keeps the record of what it did. It has no model loop
of its own — it drives a rented one (the Claude Agent SDK by default, DeepSeek and LongCat over plain
HTTP) and owns everything around it: the session, the conversation log, the tool surface, the cost cap,
and the account the work is charged to.

Local-first and single-user. A long-lived daemon holds the sessions; a CLI and an Electron console are
thin clients that talk to it over a named pipe on Windows or a unix socket elsewhere. Everything it
writes stays in the project's `.coa/` directory.

## What works today

- A session streams as it runs — output, reasoning, and tool calls. Stop or Esc interrupts the turn.
  You can also steer mid-turn: queue the new instruction as the next turn, or barge in on this one.
- Conversations persist as an append-only event log, and the daemon owns the live session rather than
  the window. Reload the console mid-turn and it reattaches to the run in progress.
- Three providers (Claude, DeepSeek, LongCat) and any number of accounts on each. `coa auth` manages
  them from the terminal; the console can drive a Claude login itself, signing each account into its
  own browser profile so the account you picked is the one that gets used.
- The model list is yours to edit per provider, and reasoning effort is set per session.
- Every turn is priced and charged against a cap that stops the session when it runs out. Subscription
  spend is estimated rather than metered.
- Read the record from the terminal: `coa cap`, `coa flags`, `coa why <target>`, `coa timeline`,
  `coa decision <id>`.

Approvals are not interactive yet. Tool calls are recorded and surfaced, but nothing pauses to ask you
first — the cost cap is what stops a run.

## Running it

Needs Node 22.20+ and pnpm 11+. On Windows the agent's shell tool wants Git for Windows; without it,
commands fall back to the platform shell.

```sh
pnpm install
pnpm build      # bundles the packages
pnpm typecheck  # also emits apps/cli/dist, where the coa binary lives
```

The console starts the daemon itself:

```sh
pnpm --filter @coa/desktop dev
```

Or drive it from the terminal — one process serving, another sending:

```sh
node apps/cli/dist/bin.js serve
node apps/cli/dist/bin.js run "explain what this repo does"
```

## Status

Pre-v1 and attended: it assumes you are sitting there watching the run. Nothing is packaged for
install yet, so building from source is the only way in. [`ROADMAP.md`](ROADMAP.md) tracks what is
real and what is missing.

Apache-2.0. See [`LICENSE`](LICENSE).
