# Design: base tools for the pure-API backend

_Status: approved (brainstorm). Feeds the implementation plan. Scope = increment 1._

## Problem

The pure-API backend (DeepSeek) has the OpenAI-style function-calling *mechanism*
(`packages/adapter-deepseek/src/complete.ts` sends `tools`, parses `tool_calls`) but coa's governed
catalogue only contains coa's structure/governance verbs (`get_symbol`, `outline`, `find_references`,
`edit_symbol`, `apply_patch`, `run_checks`, `why`, `get_spec`, `get_decision`). There is **no
`Read`/`Glob`/`Grep`/`Bash`/`Write`/`Edit`**. On Claude those come free from the SDK built-ins (the
capability frame just names them); on the pure-API path there is no executor behind the name, so the
model can "call" `Read` and get nothing. The loop cannot read, search, edit, or run — so it cannot do
coding work.

This adds those six tools as **governed, worktree-confined, in-process executors**, wired only into the
pure-API path.

## Decisions (resolved with the maintainer)

- **Increment 1 scope:** all six — `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash` — ship now.
- **Bash ships now, unconfined beyond `cwd = worktreeRoot`.** Explicitly authorized: coa is
  local-first, attended, single-user; Claude Code runs an equivalent shell today. This is recorded as a
  named S-2 deviation (see Security), not hidden.
- **No new package.** The executors are neutral, confined fs/exec handlers that depend on `confine.ts`,
  the catalogue, and the M1 `emit` spine — all already in `packages/core`. They live in a new
  `packages/core/src/workbench/base-tools.ts` beside retrieve/mutate/inspect. An `agent-core`/`explorer`
  package is unnecessary and would drag `confine.ts` + the spine ports out with it.
- **Industry-standard tooling.** Grep shells to **ripgrep** (`@vscode/ripgrep`, the binary Claude Code
  bundles); Glob uses **`tinyglobby`**; Bash uses node `child_process`. Tool *schemas* mirror Claude
  Code's exactly so the pure-API model calls them natively.

## The two orthogonal gates

Backend-conditional inclusion and role-level tool selection are **different concerns**; conflating them
was the risk in the maintainer's "explorer read-only package" note.

1. **Backend gate** — *do these executors exist at all for this provider?* Only the pure-API path needs
   them; Claude already has native, OS-sandboxed Read/Bash/etc. and must not get coa duplicates. Realized
   as `buildGovernedTools(deps, { includeBaseTools })`, set by the composition root per provider. Per
   DC-5a, backend-awareness lives in composition/adapter, never in neutral handler code.
2. **Role/package gate** — *which subset may this session call?* The existing
   `CapabilityFrame.allow/deny` → `canUseTool` path (`packages/loop-driver/src/driver.ts`) blocks any
   named tool before execution. Because each base tool is an individually-named catalogue entry, a
   read-only "explorer" role/package simply allows `Read`/`Glob`/`Grep` and denies the rest. This works
   for both backends and needs no special base-tool machinery.

Each base-tool catalogue entry also carries a capability-group tag (`read` | `write` | `exec`) so a
frame can allow-list a group instead of enumerating tools — aligned with the deferred tool-groups
direction (DC-3/DC-4). The tag is descriptive metadata in increment 1; group-level allow-listing UX is
not built here.

## The six tools

All handlers obey SC-1: **Zod-validate → dispatch → `enrich`, never throw, never deny.** A malformed
input, a confinement rejection, or a spawn failure comes back as an *unapplied* result the agent can
retry — identical to the existing retrieve/mutate handlers.

| Tool | Schema (mirrors Claude Code) | Behavior | Confinement / spine | Group |
| --- | --- | --- | --- | --- |
| `Read` | `{ path, offset?, limit? }` | file contents, `cat -n`-style numbered lines | `confinePath` first (S-1); miss/escape → unapplied | read |
| `Glob` | `{ pattern, path? }` | matching worktree-relative paths, newest-first | `confinePath` the base dir; `tinyglobby` under it | read |
| `Grep` | `{ pattern, path?, glob?, output_mode? }` | matching files/lines | `confinePath` the base; ripgrep with `--`-safe args | read |
| `Write` | `{ path, content }` | whole-file create/overwrite | `confinePath` → `emit` a `ChangeEventDraft` (`add`/`modify`, `provenance:'declared'`), reusing the mutate spine wiring (sha256 + reindex + expectPrecise) | write |
| `Edit` | `{ path, old_string, new_string, replace_all? }` | string-replacement edit | `confinePath` → apply replacement → `emit` (same spine path as Write); reuses mutate machinery, no M1 bypass | write |
| `Bash` | `{ command, timeout?, description? }` | run a shell command | injected `exec` port, `cwd = worktreeRoot`; **no path confinement** (authorized); non-zero exit / spawn error → `{ stdout, stderr, exitCode }` as a normal result | exec |

`Edit` with `replace_all: false` requires the `old_string` to be unique in the file; a non-unique or
missing match returns an unapplied result (parity with Claude Code's Edit contract), not a throw.

## Module & deps

New `packages/core/src/workbench/base-tools.ts` exposes pure handler functions over an injected
`BaseToolDeps` port (same shape discipline as `RetrieveDeps`/`WorkbenchDeps`):

- confinement inputs — `worktreeRoot`, `denyRead?`, `realpath?`
- fs ports — `readFile`, `writeFile`, `listFiles` (glob), `searchFiles` (ripgrep)
- exec port — `exec(command, opts) -> { stdout, stderr, exitCode }`
- spine ports — `emit`, and the reused `reindex?` / `expectPrecise?` from mutate

The daemon composition root (`packages/core/src/session/daemon.ts`) wires these to real node
`fs`/`child_process`/ripgrep/tinyglobby. Tests inject fakes — no real disk, no real shell.

### Wiring the backend gate

`buildGovernedTools` gains an optional `{ includeBaseTools?: boolean }`. Base-tool catalogue entries +
SPECS live in `base-tools.ts` and are appended only when the flag is set. Because base tools confine
against the single shared `worktreeRoot` (per-session worktree remains deferred, as today), the daemon
root builds **two catalogues once**:

- `core.catalogue` — governance-only (Claude).
- `core.baseCatalogue` — governance + base tools (pure-API).

`packages/core/src/session/session.ts` already computes `provider`; it selects
`provider === 'claude' ? deps.catalogue : deps.baseCatalogue` before `adapter.registerTools(...)`. No
adapter is handed fs/exec deps; core stays neutral.

## Security (SPEC alignment)

- **S-1 covers reads + writes.** SPEC §"Path-confinement precondition (S-1)" fixes that in-process MCP
  tools are confined by the deterministic `confinePath` precondition, **not** by the SDK sandbox /
  `denyRead`. `Read`/`Glob`/`Grep`/`Write`/`Edit` are in-process MCP tools → S-1 is the sanctioned,
  already-built control. Every path routes through `confinePath` before touching disk.
- **Write/Edit funnel through `emit` (P7).** SPEC §"precise-Mutate producer (producer ①)": every precise
  write emits one canonical change-event; M6 never writes disk + graph independently. Write/Edit reuse
  the existing `mutate.ts` spine path.
- **Bash is a named S-2 gap.** SPEC §D-(d) "honest scope (S-2/C13)" assumes the bash read path is bounded
  by the SDK OS sandbox (`denyRead` + bounds bash + children). On the pure-API path that sandbox does
  not exist — coa's `Bash` is a custom in-process tool with no OS bound. Recorded as an explicit,
  maintainer-authorized v1 deviation (attended, local-first, parity with Claude Code's shell). Full
  per-session process isolation stays the documented v2 hard prerequisite. `cwd = worktreeRoot` and the
  `denyRead` completed set are applied where cheap, but are not represented as containment.

## Testing

- **Per-handler units** (fakes, no real disk/shell): confinement accept + reject (`..`, absolute,
  symlink-escape, `.coa/**`); happy path; malformed args → unapplied result (not throw); Write/Edit emit
  a change-event with correct pre/post hashes; Edit non-unique/missing match → unapplied; Bash non-zero
  exit → result, not throw.
- **Catalogue gate:** `buildGovernedTools` includes the six base tools **with** `includeBaseTools` and
  **omits** them without it.
- **Selection:** the role/package gate denies a base tool by name via `canUseTool` (read-only explorer).
- **Suites:** `pnpm vitest run packages/core` + `pnpm vitest run packages/adapter-deepseek` +
  `pnpm typecheck`. A live DeepSeek smoke test (costs money, needs `DEEPSEEK_API_KEY`) only on the
  maintainer's say-so; unit + mock coverage is the default.

## Out of scope (this increment)

Per-session worktree; group-level allow-listing UX; Bash OS sandbox / process isolation; any change to
the Claude path.

---

_Last reviewed: 2026-07-03_
