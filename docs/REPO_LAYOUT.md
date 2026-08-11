# Repository Layout

> Authority for the **physical organization** of the repo and the rules that keep it coherent. Read before adding
> a package, a file, or a dependency. What the parts _are_ and why the boundaries fall where they do lives in
> [ARCHITECTURE.md](ARCHITECTURE.md); this doc is the mapping onto disk, plus the build, dependency, and
> open-source conventions.

The repo is a **pnpm monorepo**. The guiding rule: **each responsibility has exactly one physical home**, the
dependency graph is **acyclic**, and the **change-event spine is the only shared mutable substrate** — producers
and consumers point only at it, never sideways ([ENGINEERING.md](ENGINEERING.md) #1–#2).

---

## Top-level structure

```
coa/
  packages/                  libraries — the units the daemon and the apps compose
    shared/                  @coa/shared             types + Zod schemas only; no behavior, imports nothing
    code-intel/              @coa/code-intel         bytes → structure via tree-sitter; ships a second runnable
                                                     entry so the parser can run as an isolated child process
    core/                    @coa/core               the daemon: the spine plus every ring around it (below)
    spi/                     @coa/spi                the backend capability port types
    loop-driver/             @coa/loop-driver        the neutral governed agent loop the pure-API backends
                                                     share; knows no backend SDK
    adapter-claude-sdk/      @coa/adapter-claude-sdk the Claude Agent SDK backend (neutral → native render)
    adapter-openai-compat/   @coa/adapter-openai-compat  ONE thin backend over any OpenAI-compatible HTTP API,
                                                     parameterized by a data-only provider spec (endpoints,
                                                     credential and pricing pointers, reasoning-field mapping,
                                                     usage extraction). Several providers ship as spec objects,
                                                     so a new compatible provider is a new spec, not a new
                                                     package. No SDK — just fetch plus the shared loop driver
    console-viewmodel/       @coa/console-viewmodel  pure daemon-result → render-props; no electron/react/core
    console-kit/             @coa/console-kit        the console design system: theme seam, structural tokens,
                                                     component vocabulary; pure react, no electron/core
    console-transcript/      @coa/console-transcript the streaming conversation renderer — a composite built ON
                                                     the kit, never the reverse
  apps/                      shippable binaries
    cli/                     the `coa` CLI, and the daemon's composition root: it binds the core to a backend,
                             constructs the concrete adapters, stores, and login machinery, and injects them —
                             so the core declares those ports without ever building one
    desktop/                 the Electron console: a main process (the per-project window and daemon
                             registries, the pipe client, per-user persistence) plus a sandboxed renderer
                             composed from the kit. The renderer's state is push-fed slices — daemon data,
                             sessions, per-session transcripts, local view state, plus the shell's own chrome
                             store — each written by module-level functions and read through narrow
                             subscriptions. There is no whole-state object and nothing is published wholesale
  docs/                      ARCHITECTURE.md (what the system is and why its boundaries fall where they do),
                             the engineering framework (this doc, ENGINEERING, CODE_STYLE, WORKFLOW, UI), and
                             recipes/ — the how-to guides for working on specific surfaces
  test/                      repo-level tooling tests (the dependency-rule canary)
  archive/                   parked feature code — compiled by nothing, imported by nothing
  ROADMAP.md                 what is done, what is partial, what is deliberately deferred
  AGENTS.md  CLAUDE.md       how work is done (the router, plus the Claude-specific shim)
  README.md  LICENSE         the front door; Apache-2.0
  package.json               workspace root (private; scripts + devDependencies only)
  pnpm-workspace.yaml        workspace globs, the native-addon build allowlist
  pnpm-lock.yaml             committed lockfile (supply-chain integrity)
  tsconfig.base.json         shared strict compiler options; every package extends and project-references it
```

`packages/*` are libraries; `apps/{cli,desktop}` are the end-user binaries that compose them. This is the
standard pnpm split — publishable libraries stay separate from shippable apps.

**Why the daemon is one `core` package rather than several.** Its rings share the in-process graph and the
single-writer log, and splitting them would turn one in-process call into a package boundary for no gain. The
discipline that keeps it from becoming a tangle is enforced **inside** `core` by directory boundaries and the
dependency ruleset below — not by package splits.

### Inside `packages/core` (the rings)

| Directory      | What lives there                                                                        |
| -------------- | --------------------------------------------------------------------------------------- |
| `src/*.ts`     | **the spine**: the kernel (append and subscribe, the in-memory graph host), the change event, the projection mirror, the checkpoint timeline, the idle scheduler. `index.ts` is the package barrel |
| `graph/`       | spine — the in-memory graph, the symbol table, import and piece resolution               |
| `wal/`         | spine — the single-writer append log                                                     |
| `reconcile/`   | spine — the git-centric reconciler (the second producer)                                 |
| `scope/`       | spine — scope config, resolution, linting, and the glob machinery                        |
| `flags/`       | the one flag pipeline (register a producer, ingest), dedup, the two audiences, the close gate, the per-tool deny rules, and the user-invoked validator |
| `context/`     | generation, drift detection, and origin-anchor verification                              |
| `compiler/`    | compiling config pieces into one neutral config                                          |
| `workbench/`   | the precise edit producer and the tool surface handed to the loop, including the disk, process, and web halves the composition root binds into it |
| `governance/`  | the cost ledger and the sandbox posture                                                  |
| `models/`      | the model catalog and effective-model resolution                                         |
| `library/`     | the skills and tool-server library — on-disk discovery of the surrounding tools' own conventions, the declarative link-or-copy stores at both scopes, on-demand drift hashing, and the fold that turns a selection into prompt material |
| `auth/`        | the credential-blind account registry — login pointers, never secrets                    |
| `console/`     | the console state store                                                                  |
| `session/`     | the daemon host, session and worktree lifetime, the drive strategies, a turn's own lifecycle state machine (its legal edges enumerated as a table, read by both drivers and the service), the agent registry, and the inter-agent message log |
| `rpc/`         | the JSON-RPC server plumbing                                                              |

**The intra-`core` rule** (mechanically enforced): only the spine — the root-level files plus `graph/`, `wal/`,
`reconcile/`, and `scope/` — is shared mutable substrate. Every other ring imports **the spine and
`@coa/shared`**, never a sibling ring sideways. Two hubs are exempt because composing rings is their job:
`session/` (it wires the rings into a daemon) and `rpc/` (it exposes them over JSON-RPC). `compiler/` reads what
`context/` produces, never the reverse. `workbench/` is a producer — it writes through the spine and reads
`flags/`, `context/`, and `governance/` only.

## Dependency rules (enforced by `dependency-cruiser`)

The ruleset asserts the architecture's arrows as hard constraints:

- **Acyclic** — no cross-package and no cross-ring import cycles.
- **`@coa/shared` imports nothing**; everything may import it.
- **Producers → spine ← consumers** — no consumer ring imports another consumer ring sideways.
- **Backend isolation** — only the Claude adapter may import a backend SDK. There is no `which-backend?` branch
  anywhere else.
- **Apps depend on libraries, never the reverse** — `apps/*` import `packages/*`; no package imports an app.
- **Backends are injected, not imported** — `core` does not depend on any adapter package. The app composition
  root constructs the concrete backends and passes them in through the port types in `spi`, which is what keeps a
  backend a swappable leaf. The shared loop driver is the neutral engine adapters build on, and may never import
  an adapter back.
- **`console-viewmodel` stays pure** — never `electron`, `react`, or `core`.
- **`console-kit` and `console-transcript` are pure UI packages** — react and its ecosystem only, never
  `electron` or `core`. The transcript depends on the kit; the kit never depends on the transcript, because the
  one-way edge is what keeps the kit small enough to review.
- **The ruleset is kept honest, not decorative.** Every package's `exports` map carries a `development`
  condition pointing at its TypeScript source, and the cruiser resolves `development` first — so cross-package
  `@coa/*` edges land on the source paths the rules are written against instead of on built output (which is
  excluded from the graph entirely). A canary test in `test/` plants a forbidden edge and asserts it is reported,
  so a resolution regression cannot silently disarm every cross-package rule at once.

A violation fails the gate. When a genuinely new edge is needed, the architecture doc and the ruleset change in
the **same commit**.

## Per-package anatomy

```
packages/<name>/
  src/                 source; one primary export per file (CODE_STYLE)
  src/**/*.test.ts     unit tests co-located with the unit (Vitest)
  test/                cross-module or integration tests for this package (optional)
  package.json         name @coa/<name>, exports map (with the `development` condition), scripts, deps
  tsconfig.json        extends ../../tsconfig.base.json; project-references its workspace deps
  tsdown.config.ts     bundle config, for the libraries that ship build output
```

- **One primary export per file**; the file is named for it. `@coa/shared` exports types and schemas and **no
  runtime behavior**.
- **`code-intel` has two build entries**: the library API _and_ a separate runnable parser process — so running
  the tree-sitter parser in isolation is a flag rather than a re-tooling. A native crash on a hostile file takes
  down the child, not the daemon.
- **`core` publishes a second entry point** beside its root barrel: the native-free JSON-RPC transport surface —
  the pipe client and the endpoint helpers a console or CLI process needs, without the graph and parser modules
  that eagerly load native addons. That is what keeps the Electron main process from pulling a Node-ABI binary
  into a differently-built runtime. Its one cost is a resolution trap worth knowing: the **test-time workspace
  aliases must be anchored to exact matches**, because a plain string alias matches a path _prefix_, so an
  unanchored `@coa/core` swallows the subpath too and rewrites it onto the root barrel's file path instead of
  letting it fall through to the package's own `exports` map the way runtime resolution does.
- Not every package needs a bundle. A renderer-side package the desktop app compiles from source has no
  `tsdown.config.ts` at all; the `development` export condition is what lets the rest of the toolchain resolve it
  as source.

## Build & packaging

- **Bundler: `tsdown`** (Rolldown and Oxc, tsup-compatible), **pinned to an exact version** because it is
  pre-1.0. **Documented fallback:** `tsc` plus esbuild if the 0.x cadence churns.
- **Toolchain pinning** — the `packageManager` field pins pnpm; `engines` plus `.nvmrc` pin Node. Native addons
  are rebuilt deterministically for the **daemon's Node ABI**, never Electron's.
- **Supply-chain hygiene** — the lockfile is committed. Install scripts are **off by default**, with an explicit
  allowlist in `pnpm-workspace.yaml` for the native addons that legitimately need them; Electron's and esbuild's
  own postinstalls are pinned off, since they only fetch runtime binaries that typechecking and bundling do not
  need. Install-time scripts run _before_ any sandbox exists, which makes this the highest-leverage
  supply-chain control in the repo.
- **Gates** — `pnpm check` runs typecheck, lint, format, tests, and the dependency ruleset locally.
  Automated CI, and the dependency-audit step that belongs in it, is still ahead (see
  [ROADMAP.md](../ROADMAP.md)); until it lands, the gate is run by hand before every commit
  ([WORKFLOW.md](WORKFLOW.md)).

## Open-source scaffolding

The repo is Apache-2.0 and built to open. The following is the **target** structure; each file is created when
the project reaches it, not pre-littered:

```
LICENSE                  Apache-2.0 (present)
NOTICE                   attribution + copyright line
CONTRIBUTING.md          how to set up, run the gates, and propose changes (the workflow loop, externalized)
CODE_OF_CONDUCT.md       standard (Contributor Covenant)
SECURITY.md              how to report a vulnerability (relevant: coa governs an agent and runs its code)
CHANGELOG.md             Keep-a-Changelog, fed by the Conventional Commit history
.github/
  workflows/             CI (the gates above)
  ISSUE_TEMPLATE/        bug and feature templates
  PULL_REQUEST_TEMPLATE.md
```

- **Conventional Commits are the changelog substrate** — another reason the subject-line discipline
  ([AGENTS.md](../AGENTS.md)) matters.
- **PR flow arrives with outside contributors.** Today it is a single `main` and commit-as-you-go
  ([WORKFLOW.md](WORKFLOW.md)); the dependency rules and gates above are exactly what a PR check would enforce.
- **Apache-2.0 specifics** — per-file license headers are optional; LICENSE plus a NOTICE covers attribution.
  The patent grant is why Apache-2.0 was chosen over MIT.

## Where non-code things live

- **What the system is, and why** → [`ARCHITECTURE.md`](ARCHITECTURE.md). Amended in place; a durable
  decision is written into the section whose constraint it explains.
- **Status and deferred intent** → [`ROADMAP.md`](../ROADMAP.md).
- **How to work on a specific surface** → [`docs/recipes/`](recipes/) — one page per task, added when a surface
  is fiddly enough that the next person would otherwise rediscover it.
- **Parked feature code** → `archive/`, each entry with a row in [its README](../archive/README.md) recording
  what it was, why it was parked, and what would revive it. Nothing there is compiled, linted, formatted,
  cruised, tested, or indexed — so a parked feature cannot quietly become load-bearing, and reviving one is a
  deliberate move back into the tree.
- **Agent definitions** → per-scope directories: personal agents under the user's home config, project agents
  committed alongside the repo they belong to. The daemon loads both scopes plus its built-in definitions, and a
  project definition wins on a name collision.
- **Briefs, plans, review reports, throwaway scripts** → the session scratchpad, **never committed**.

---

_Last reviewed: 2026-08-11_
