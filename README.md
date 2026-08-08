# coa

coa is a workbench for harness-independent agentic development. It has no model loop of its own — it
drives a rented one and owns everything around it: the daemon that holds the sessions, the
conversation record, the tool surface the model is given, the agents, and the account the work runs
under. Change the backend and the way you work does not change with it.

Local-first and single-user. A long-lived daemon holds the sessions; a CLI and an Electron console are
thin clients that talk to it over a named pipe on Windows or a unix socket elsewhere. Everything it
writes stays in the project's `.coa/` directory, next to per-user files under `~/.coa/`.

## Backends

One seam, two shapes behind it. **Claude** runs through the Claude Agent SDK, which coa drives as a
long-lived session and governs through the SDK's own hooks. **DeepSeek, LongCat, OpenAI and
OpenRouter** run through a single OpenAI-compatible adapter: one HTTP path (request build, streaming,
tool calls, pricing, credentials, model discovery) parameterized by a per-provider data record — base
URL, default model, key variable, price table, reasoning mapping, usage shape. Adding another
OpenAI-compatible API is another record, not another integration.

Tools, agents, the conversation record and the governance seam are coa's on every backend, so
switching providers mid-project changes the model and nothing else.

## What works today

- **Sessions live in the daemon, not in the window.** Reload the console mid-turn and it reattaches to
  the run in progress. Sending again on a live conversation queues the next turn rather than starting
  a second session.
- **Conversations persist as one append-only event log.** The transcript you read and the history the
  model is resumed with are both read-time projections of that log, so nothing has to be written twice
  to stay consistent.
- **Turns stream** — output, reasoning, and tool calls as they happen. Stop or Esc interrupts the
  turn. A steer is queued and delivered at the next point in the turn where the model can legally
  receive it, and is recorded where the model actually received it.
- **coa owns the tool surface**: read, glob, grep, write, edit and shell, plus web search and fetch,
  plus subagent dispatch. Every call passes one gate before it runs, on either backend.
- **Agents are files.** A built-in starter set, plus anything in `~/.coa/agents` and the repo's
  `.coa/agents`; the console edits them. An agent can dispatch a child session, which keeps a link to
  its parent.
- **Accounts are pointers, never secrets.** Any number of accounts per provider; the account list
  stores an environment-variable name or the path to a key file coa wrote with owner-only permissions.
  `coa auth` manages them from the terminal. For a Claude subscription the console can drive the login
  itself, signing each account into its own browser profile so the account you picked is the one that
  gets used.
- **The model list is yours.** A per-provider list in `~/.coa/models.yaml`, seeded from a shipped
  catalog and enriched by the provider's own live list; a failed live fetch degrades the list instead
  of emptying it. Reasoning effort is set per session wherever the model exposes it.
- **Spend is accounted, not capped.** Every settled turn is priced from a per-model rate table and
  recorded against the account that ran it. coa imposes no ceiling of its own — a run ends when your
  plan's own limit ends it. Subscription work is modelled at API-equivalent rates, since none of it is
  billed per token.
- **Changes are reconciled against the worktree** after every tool call, so an edit made by a shell
  command reaches the record alongside the ones coa performed itself.
- **Inspector reads from the terminal**: `coa flags`, `coa timeline`.

The only thing coa ever blocks is a session declaring itself finished while a blocking flag stands.
Everything else surfaces and advises.

## Not there yet

- **Approvals are not interactive.** Tool calls are recorded and surfaced, but nothing pauses to ask
  you first.
- **The console's usage view is a mock surface** — the layout is real, the numbers behind it are not
  yet wired to the ledger.
- **Nothing is packaged for install.** Building from source is the only way in.

[`ROADMAP.md`](ROADMAP.md) tracks the rest.

## Running it

Needs Node 22.20+ and pnpm 11+. On Windows the shell tool looks for Git Bash so the model's POSIX
one-liners work; without it, commands fall back to the platform shell (`COA_BASH_SHELL` forces a
specific shell binary on any platform).

```sh
pnpm install
pnpm build      # bundles the workspace packages
pnpm typecheck  # also emits apps/cli/dist, where the coa binary lives
```

Drive it from the terminal — one process serving, another sending:

```sh
node apps/cli/dist/bin.js serve
node apps/cli/dist/bin.js run "explain what this repo does"
```

Or start the console, which starts the daemon itself (and attaches to one already running):

```sh
pnpm --filter @coa/desktop dev
```

Electron's runtime binary is not downloaded by default — install scripts are off unless a package is
listed in `allowBuilds` in `pnpm-workspace.yaml`, and `electron` is listed there as `false` because
typechecking and bundling do not need it. Set it to `true` and re-run `pnpm install` before the first
`dev` run.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit together.
- [`ROADMAP.md`](ROADMAP.md) — what is real, what is missing, what is next.
- [`docs/recipes/`](docs/recipes/) — task recipes, including pointing the OpenAI-compatible adapter at
  a local subscription bridge.

## Status

Pre-v1 and attended: it assumes you are sitting there watching the run.

Apache-2.0. See [`LICENSE`](LICENSE).

_Last reviewed: 2026-08-08_
