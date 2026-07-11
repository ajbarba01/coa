# Repository Layout

> CORE doc — the **physical organization** of the repo and the rules that keep it coherent. Read before adding a
> package, a file, or a dependency. The _logical_ module definitions live in
> [design/handoff/SPEC.md](design/handoff/SPEC.md) §A; this doc is the logical→physical mapping plus the build,
> dependency, and open-source conventions.

The repo is a **pnpm monorepo**. The guiding rule: **each logical module (M0–M10) has exactly one physical home**,
the dependency graph is **acyclic and topological**, and the **change-event spine (M1) is the only shared mutable
substrate** — producers and consumers point only at it, never sideways ([ENGINEERING.md](ENGINEERING.md) #1–#2).

---

## Top-level structure

```
coa/
  packages/                  libraries (the logical modules)
    shared/                  M0 — @coa/shared        (types + Zod schemas only; no behavior)
    code-intel/              M2 — @coa/code-intel     (pure byte→structure; child-process parser seam)
    core/                    M1,M3–M8 — @coa/core     (the spine + consumers + services; see below)
    spi/                     M9 ports — @coa/spi       (capability port types; null-fallback contracts)
    loop-driver/             M9 — @coa/loop-driver     (coa-owned governed ReAct loop for pure-API backends; `complete()` primitive + driver; neutral, no backend SDK)
    adapter-claude-sdk/      M9 impl  — @coa/adapter-claude-sdk (neutral→native render, TS-LSP backend, SDK loop)
    adapter-deepseek/        M9 impl  — @coa/adapter-deepseek (thin pure-API backend: DeepSeek `complete()` over HTTP + the shared loop-driver; no backend SDK, just fetch)
    adapter-longcat/         M9 impl  — @coa/adapter-longcat (thin pure-API backend: LongCat `complete()` over HTTP + the shared loop-driver; no backend SDK, just fetch)
    console-viewmodel/       M10 — @coa/console-viewmodel (pure daemon-result→render-props; no electron/react/core)
    console-ui/              M10 — @coa/console-ui (design tokens + the component kit + COMPONENTS.md; pure react/radix, no electron/core). `dense/` holds the chat-surface members (Composer, the non-virtualized Transcript + its internal FindBar, the rich `ToolCard` + its supporting `ToolDiffView.tsx`/`syntaxTheme.tsx`/`pathLanguage.ts`/`clampLines.ts`/`matchLines.ts` (clickable search-match parser)/`runChecks.tsx` (run_checks status chips)/`errorMarks.tsx` (red error-token marker), plus pure helpers scrollState.ts/find.ts); `smoothScroll.ts` was removed with the virtualized transcript. `layout/` gained `PaneOverlay.tsx` (the pane-confined expand surface `ToolCard` opens into).
    console-kit/             M10 — @coa/console-kit (the workbench design system's kit: sand-dark theme seam + structural tokens + component vocabulary, COMPONENTS.md generated; pure react/@base-ui, no electron/core)
  apps/                      shippable binaries (M10 Console)
    cli/                     M10 — the `coa` CLI (talks only to the daemon's JSON-RPC catalogue)
    desktop/                 M10 — the Electron console (electron-vite; main pipe-client, isolated renderer). The renderer is the three-column workbench (`src/renderer/shell/`: nav + center canvas + collapsible session column, daemon gate, ⌘K palette, settings dialog) composed from `@coa/console-kit`, fed by the controller in `src/renderer/console.ts` publishing one `ConsoleState` into a store; center surfaces (`src/renderer/panels/`) still render on `console-ui` until the conversation/surfaces re-skins land. The IPC bridge is generated from a shared Zod method registry (`src/shared/methods.ts`); the shell arrangement (surface/tabs/columns) and console settings (density/motion) persist per-user via the main process (`src/main/persistence.ts`: `layout.json` + `settings.json`). Tool-card links resolve through main-owned IPC: `src/main/openPath.ts` reveals a file in the editor (`code -g`, spawned shell-free + worktree-confined, resolved against the daemon's project root) and `src/main/openExternal.ts` opens a web URL in the browser (http/https-validated).
  docs/
    design/handoff/          SPEC.md (a per-module index over spec/M0..M10.md) · IMPL-SPEC-BRIEF.md · OPEN.md  (product source of truth)
    adr/                     architecture decision records — immutable, the durable "why" (README is the index)
    superpowers/             transient in-flight specs/ + plans/; graduated to adr/ + ROADMAP, then deleted (reappears as new work needs it)
    *.md                     the engineering framework (this doc, ENGINEERING, CODE_STYLE, WORKFLOW, DESIGN, UI)
  AGENTS.md  CLAUDE.md       how work is done (router + Claude shim)
  ROADMAP.md                 project status + path forward (the in-repo status authority)
  LICENSE                    Apache-2.0
  package.json               workspace root (private; scripts + devDeps only)
  pnpm-workspace.yaml        workspace globs
  pnpm-lock.yaml             committed lockfile (supply-chain integrity)
  tsconfig.base.json         shared strict compiler options; per-package tsconfig extends + project-references it
```

`packages/*` are libraries (publishable units, the logical modules); `apps/{cli,desktop}` are the end-user
binaries that compose them. This is the standard pnpm/Turborepo split — publishable libs stay separate from
shippable apps.

## The logical → physical map (from SPEC §A.4)

| Module                       | Package                                | Notes                                                                              |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| M0 Shared Schema             | `packages/shared`                      | Types + Zod schemas only; imported by everything; imports nothing.                 |
| M1 Change Kernel             | `packages/core` → the **spine** ring   | WAL, bus, in-mem graph, symbol table / fuzzy index / piece-resolver, projections. |
| M2 Code Lens                 | `packages/code-intel`                  | Byte→structure; the parser runs as a **separate child process** (isolation seam).  |
| M3 Constraint & Flag         | `packages/core` → a **consumer** + gate | Flags projection + the one close-gate service.                                     |
| M4 Context Engine            | `packages/core` → **consumer/services** | Staleness consumer + generation/assembly/grounding/detection services.            |
| M5 Config Compiler           | `packages/core/compiler/`              | `compile(pieces) -> NeutralConfig`; **promotable to a standalone `compiler` package if it grows.** |
| M6 Workbench                 | `packages/core` → **producer** + `mcp/` | The precise Mutate producer + the outer-ring tool surface; `workbench/base-tools.ts` (Read/Glob/Grep/Write/Edit/Bash for non-`claude` providers) pulls in `@vscode/ripgrep` + `tinyglobby`; `workbench/render-result.ts` renders each tool's structured result to human-readable display text (+ a success predicate) for the pure-API loop, which has no SDK-provided result text; `workbench/web/` (credential-gated WebSearch/WebFetch) pulls in `turndown` and routes BOTH tools through cooldown-aware provider chains (`routing.ts` + `key-state-store.ts` → `~/.coa/web-keys.json`, shared `limits.ts` classifiers): fetch = `firecrawl.ts`/`tavily.ts` scrape+extract → `plain-fetch.ts` free floor; search = `tavily.ts`/`firecrawl.ts`/`parallel.ts`; the WebFetch summarizer is composed at the daemon root over `@coa/adapter-deepseek`. Keys are managed user-global via `workbench/web/web-config-store.ts` (`~/.coa/web.yaml` pointers + `~/.coa/keys/` secrets), driven by the `coa websearch`/`coa webfetch` CLI (`apps/cli/src/web-cli.ts`) and loaded into the daemon by `apps/cli/src/session-deps.ts`. |
| M7 Governance & Audit        | `packages/core` → **consumers** + policy | Cost ledger, provenance, decision log, sandbox/process-isolation posture.          |
| M8 Daemon Orchestration      | `packages/core` → services + `rpc/`    | Transport, session, worktree, daemon host (lifecycle, not domain logic).           |
| M9 Runtime Adapter           | `packages/spi` + `packages/loop-driver` + `packages/adapter-claude-sdk` + `packages/adapter-deepseek` + `packages/adapter-longcat` | Ports (types) + the shared pure-API loop driver + the SDK backend + the thin DeepSeek backend + the thin LongCat backend. |
| M10 Console                  | `apps/cli` + `apps/desktop` + `packages/console-viewmodel` + `packages/console-ui` + `packages/console-kit` | CLI first; `apps/desktop` is the Electron console ("app" in SPEC §A.4); `console-viewmodel` is its pure daemon-result→render-props layer; `console-ui` owns the design tokens + component kit; `console-kit` owns the workbench design system's kit (theme seam, structural tokens, component vocabulary). |

**Why M1 and M3–M8 share one `core` package.** They are the daemon's rings around the spine; they share the
in-process graph and the single-writer WAL, and the SPEC keeps them co-located. The discipline that prevents this
from becoming a tangle is enforced **inside** `core` by directory boundaries and the dependency ruleset below —
not by package splits.

### Inside `packages/core` (the rings)

```
core/src/
  spine/         M1 — emit/subscribe, WAL writer, in-mem graph, symbol table, fuzzy index, piece-resolver,
                      reconciler (producer ②), checkpoint/rewind, signal bus, idle scheduler
  flags/         M3 — the one pipeline (registerProducer/ingest), dedup, the two audiences, the close-gate
  context/       M4 — generation, assembly, grounding, detection/staleness services
  compiler/      M5 — compile(pieces) -> NeutralConfig (its own service boundary)
  workbench/     M6 — the Mutate producer + mcp/ tool surface
  governance/    M7 — cost ledger, provenance, decision log, policy
  session/ rpc/  M8 — daemon host, session/worktree managers, JSON-RPC server
  auth/          credential-blind account registry — login pointers (no secrets), the active-login selector
```

**The intra-`core` rule** (mechanically enforced): only `spine/` is shared mutable substrate. `flags/`,
`context/`, `governance/`, etc. import **from `spine/` and `@coa/shared`**, never from each other. `compiler/`
reads `context/`'s output but not vice versa. `workbench/` is a producer (writes via `spine/.emit`) and reads
`flags/`/`context/`/`governance/` only as the SPEC's M6 dependency allows.

## Dependency rules (enforced by `dependency-cruiser` in CI)

The ruleset asserts the SPEC §A.4 arrows as hard constraints:

- **Acyclic** — no cross-package and no cross-ring import cycles. The topological order must hold.
- **`shared` (M0) imports nothing**; everything may import it.
- **Producers → spine ← consumers** — no consumer ring imports another consumer ring sideways; everything goes
  through `spine/`.
- **Backend isolation** — only `adapter-claude-sdk` may import the Claude Agent SDK (or any backend SDK). The core
  calls `spi` port types and takes the defined null-fallback (D109) — no `which-backend?` branch anywhere else.
- **Apps depend on libraries, never the reverse** — `apps/*` import `packages/*`; no package imports an app.
- **M9 fan-in is injected, not imported** — `core` does not compile-time-depend on `adapter-claude-sdk`; M8 wires
  the adapter in at session construction (dependency injection), keeping M9 a swappable leaf.
- **`console-viewmodel` stays pure** — it imports only `zod` today (it may add `@coa/shared` later), never
  `electron`/`react`/`core` (enforced: `viewmodel-no-electron-react`).
- **`console-ui` is a pure UI kit** — it imports only `react`/`radix-ui`/`lucide-react` (+ its own tokens), never
  `electron`/`core` (enforced: `console-ui-no-electron-core`).

A violation fails CI. When a genuinely new edge is needed, it changes the SPEC §A.4 map and the ruleset in the
**same commit** (the same-commit doc rule).

## Per-package anatomy

```
packages/<name>/
  src/                 source; one primary export per file (CODE_STYLE)
  src/**/*.test.ts     unit tests co-located with the unit (Vitest)
  test/                cross-module / integration tests for this package (optional)
  package.json         name @coa/<name>, exports map, scripts, deps
  tsconfig.json        extends ../../tsconfig.base.json; references its workspace deps
  tsdown.config.ts     bundle config (libraries that ship build output)
```

- **One primary export per file**; the file is named for it. M0 (`shared`) exports types/schemas and **no runtime
  behavior**.
- **`code-intel` has two entry points**: the library API _and_ a **separate runnable parser-process entry** — so
  running the tree-sitter parser as an isolated child process is a build flag, not a re-tooling (D112). A
  native-addon crash on a hostile file takes down the child, not the daemon.

## Build & packaging

- **Bundler: `tsdown`** (Rolldown+Oxc, tsup-compatible), **pinned to an exact version** (it is pre-1.0).
  **Documented fallback:** `tsc` + esbuild if the 0.x cadence churns. The bundler emits the `code-intel` parser as
  a separate runnable process entry (above).
- **Toolchain pinning** — `packageManager` field pins the pnpm version; `engines` + `.nvmrc` pin the Node version.
  Native addons are rebuilt deterministically for the **daemon's Node ABI**, never Electron's.
- **Supply-chain hygiene** — commit `pnpm-lock.yaml`; verify integrity (lockfile + content hashes); default
  **`--ignore-scripts`** with an explicit native-addon allowlist for packages that legitimately need build scripts
  (`better-sqlite3`, `@parcel/watcher`, the tree-sitter binding). Install-time `postinstall` runs _before_ any
  sandbox, so this is the highest-leverage supply-chain control.
- **CI gates** — `pnpm audit` / `osv-scanner` on the committed lockfile, plus the standard gates (typecheck, lint,
  format, tests, dependency-cruiser). See [WORKFLOW.md](WORKFLOW.md).
- **Dependency pins (re-confirm at build time)** — the secondary backend path is `ai@^6` + `@ai-sdk/anthropic@^3`,
  behind the M9 port; do not jump to the unstable majors.

## Open-source scaffolding

The repo is Apache-2.0 and built to open. The following is the **target** OSS structure; each file is created when
the project reaches it (not pre-littered):

```
LICENSE                  Apache-2.0 (present)
NOTICE                   attribution + copyright line (add once the copyright holder is confirmed — DESIGN.md open Q)
CONTRIBUTING.md          how to set up, run gates, and propose changes (the WORKFLOW loop, externalized)
CODE_OF_CONDUCT.md       standard (Contributor Covenant)
SECURITY.md              how to report a vulnerability (relevant: coa governs an agent + runs sandboxed code)
CHANGELOG.md             Keep-a-Changelog, fed by the Conventional Commit history
.github/
  workflows/             CI (the gates above)
  ISSUE_TEMPLATE/        bug / feature templates
  PULL_REQUEST_TEMPLATE.md
```

- **Conventional Commits** are the changelog substrate — another reason the subject-line discipline
  ([AGENTS.md](../AGENTS.md) Constitution) matters.
- **PR flow** arrives with outside contributors (today it is single `main`, commit-as-you-go; see
  [WORKFLOW.md](WORKFLOW.md)). The dependency rules and gates above are exactly what a PR CI check enforces.
- **Apache-2.0 specifics** — source-file license headers are optional but the LICENSE + a NOTICE (once the holder
  is set) cover attribution; the patent grant is the reason Apache-2.0 was chosen over MIT.

## Where non-code things live

- **Product source of truth** → `docs/design/handoff/` (SPEC / IMPL-SPEC-BRIEF / OPEN). Amended in place.
- **Durable decisions (the why)** → `docs/adr/` — immutable ADRs; see the doc-lifecycle rule in
  [WORKFLOW.md](WORKFLOW.md).
- **Project status / path forward** → [`ROADMAP.md`](../ROADMAP.md).
- **In-flight specs & plans** → `docs/superpowers/{specs,plans}/` — **transient**: they exist to get a change
  built, graduate their durable decisions to ADRs + ROADMAP, then are deleted (git history is the archive). The
  directory reappears when the next plan is written.
- **Throwaway scripts / scratch output** → the session scratchpad, **never committed**.

---

_Last reviewed: 2026-07-10_
