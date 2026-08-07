# Reference shortlist — coa improvement arc

Researched 2026-08-07 by a 5-category web sweep + adversarial license verification (11
agents). Every license below was verified against the repo's actual LICENSE file, not
memory. Allowlist: MIT, ISC, BSD-2/3-Clause, Apache-2.0, CC0/Unlicense — anything else is
**study-only** (patterns, never code).

**Status: awaiting maintainer sign-off.**

## Tier 1 — primary references (the arc clones these and reads them deeply)

| Project | License (verified) | Adapt? | What it's the reference FOR |
|---|---|---|---|
| [Cline](https://github.com/cline/cline) | Apache-2.0 | ✅ adapt | **Permission modes** (Plan/Act toggle, per-category auto-approve allowlist, max-consecutive-approvals budget) · **MCP management** (marketplace, per-server enable/health, `cline_mcp_settings.json`) · OpenRouter model metadata. TS/React — ports well. |
| [goose](https://github.com/block/goose) (Block) | Apache-2.0 | ✅ adapt (desktop UI is TS) | **Architectural sibling**: Electron/TS console over a local daemon. Permission-mode UI (`ui/desktop/src/components/settings/permission/`), extensions manager, multi-provider config. |
| [opencode](https://github.com/anomalyco/opencode) | MIT | ✅ adapt | **Per-model metadata** (models.dev catalog: context window, pricing, modality flags) · per-tool permission rules · client/server split · token-based theming. TS pnpm monorepo — directly portable. (Courtesy: don't reuse the "opencode" name.) |
| [LibreChat](https://github.com/danny-avila/LibreChat) | MIT | ✅ adapt | **Multi-provider endpoint abstraction** (declarative config normalizing OpenAI/Anthropic/OpenRouter/custom behind one seam — coa's adapter unification) · API-key management · MCP config scoping · composer attachments with per-endpoint capability gating. |
| [VS Code](https://github.com/microsoft/vscode) | MIT (source repo; branded binary is proprietary) | ✅ adapt | **Extension lifecycle** (install, per-workspace vs global enable, `extensions.json`, manifest/contribution-point model — coa's skills/plugin manager) · canonical Electron process/IPC architecture · semantic color-token theming (light+dark). |
| [Podman Desktop](https://github.com/podman-desktop/podman-desktop) | Apache-2.0 | ✅ adapt | **Right-sized Electron governance console** over external daemons — much closer to coa's scale than VS Code. Typed IPC bridge, extension loader, live-updating panes fed by backend event streams. |
| [big-AGI](https://github.com/enricoros/big-AGI) | MIT | ✅ adapt | **Per-model metadata ledger** (context window, pricing, capability flags auto-refreshed from OpenRouter/provider APIs, driving UI badges + cost estimation) · **conversation auto-naming**. |
| [OpenAI Codex CLI](https://github.com/openai/codex) | Apache-2.0 | ✅ adapt (protocol/schema layer) | **Approval policy as a typed protocol**: AskForApproval separated from sandbox policy, JSON-Schema-defined approval interactions with generated TS types — the model for coa's daemon↔console permission wire contract. |
| [Traycer](https://github.com/traycerai/traycer) *(maintainer-added)* | MIT | ✅ adapt | **Multi-agent orchestration desktop app** — the closest product analog to coa's orchestration goal: parallel agents with shared memory across models/providers, agent-to-agent communication, bring-your-own-agent (drives Claude Code/Codex/others), modern polished UI. Caveat: young (~1.1k stars, launched mid-2026) — verify code quality per-file before adapting. |

## Tier 1 — study-only (patterns are the product; code is off-limits)

| Project | License (verified) | Why it's still Tier 1 |
|---|---|---|
| [Zed](https://github.com/zed-industries/zed) | GPL-3.0 (editor/agent crates) + Apache-2.0 (gpui etc.) — treat as GPL | **The polish bar**: threaded agent sessions, inline tool-call approval, follow-along diff review, per-profile tool permissions, first-class light/dark token theming. The definitive UX reference for console polish + light theme. |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio) | AGPL-3.0 (dual-licensed commercial) | **Nearest-neighbor console** (Electron, strict TS, multi-provider, MCP manager, light/dark tokens) — prime study for IPC layering, settings schema, MCP-management UX. |
| [Claude Code](https://github.com/anthropics/claude-code) (docs) | Proprietary | **The interoperability spec, not inspiration**: permission-mode names/semantics (default/plan/acceptEdits/bypass), allow/ask/deny rule syntax, settings precedence, `~/.claude` skills/plugins layout, `.mcp.json` layering. coa's discover-and-link feature must read these conventions correctly. |
| [Jan](https://github.com/janhq/jan) | Apache-2.0 **+ appended attribution-request line** (GitHub reports NOASSERTION) | Closest open-license analog to coa's product shape; model catalog with capability tags + health state in the UI. The extra clause is likely non-binding but fails the strict allowlist — study-only, no judgment call. |

## Tier 2 — targeted references (consulted for one feature each)

| Project | License | Adapt? | For |
|---|---|---|---|
| [Continue](https://github.com/continuedev/continue) | Apache-2.0 | ✅ | Declarative model-role config, provider adapter layer, @-mention attachments in the composer. |
| [OpenHands](https://github.com/OpenHands/OpenHands) | MIT | ✅ (mostly Python → patterns) | Event-stream architecture (append-only log drives loop + UI — validates coa's spine), risk-graded confirmation UX, agent delegation. |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) | Apache-2.0 (**archived 2026-05**; successor closed — never pull post-archive code) | ✅ (frozen snapshot) | Custom permission modes bound to subagent orchestration (Orchestrator/Boomerang subtask pattern). |
| [Insomnia](https://github.com/Kong/insomnia) | Apache-2.0 | ✅ | JSON-defined theme/token system where light theme is data; plugin discovery from a user directory (`~/.insomnia`). |
| [Bruno](https://github.com/usebruno/bruno) | MIT | ✅ | Local-first filesystem-as-database Electron design; file-watch → live pane update pipeline (informs worktrees + project-linked skills). |
| [Hyper](https://github.com/vercel/hyper) | MIT | ✅ | Compact end-to-end config-file-driven plugin discovery + hot reload; small enough to read fully. |
| [MCPM](https://github.com/pathintegral-institute/mcpm.sh) | MIT | ✅ (Python → data model) | Exactly coa's discover-and-link flow: reads/writes MCP configs of many clients in well-known directories, profiles, per-client vs global linking. |
| [MCP Registry](https://github.com/modelcontextprotocol/registry) | Composite (Apache-2.0/MIT per contribution, CC-BY-4.0 docs) | study (model the schema, don't port) | Canonical `server.json` metadata schema + registry API for MCP discovery. |
| [Obsidian plugin system](https://github.com/obsidianmd/obsidian-api) | API typings MIT; app closed-source | study | Lightweight plugin registry (`manifest.json` + `versions.json`, minAppVersion gating, per-vault enable, restricted-mode default) at coa's scale. |
| [Open WebUI](https://github.com/open-webui/open-webui) | BSD-3 **+ custom branding clause 4** | study | Admin model catalog with per-model capability/permission controls; largest permission-UX dataset in the space. |
| [Signal Desktop](https://github.com/signalapp/Signal-Desktop) | AGPL-3.0 | study | Strictest Electron security posture on coa's exact stack: sandboxed renderers, typed preload bridge, better-sqlite3 confined to a worker. |

## Professional-UI coverage (maintainer asked)

The polish bar is set by **Zed** (study-only — the definitive agent-panel UX and
light/dark token discipline) and **Cherry Studio** (study-only — nearest-neighbor Electron
console). Among adapt-eligible refs, the UI exemplars are **goose's desktop app**,
**Traycer**, **Insomnia** (theme/token system), and **VS Code** (semantic token theming).
For visual craft beyond code, the impeccable skill + coa's own design system carry the
standard; mockups are approved before the arc runs, so UI taste is contract-fixed anyway.

## License traps caught (why verification wasn't optional)

- **Zed** ships two licenses; the crates you'd want (editor, agent) are GPL-3.0.
- **Cherry Studio** is AGPL despite being the closest console analog.
- **Open WebUI** appended a branding-protection clause to BSD-3 (GitHub calls it NOASSERTION).
- **Jan** appended an attribution-request sentence to Apache-2.0 — modified license text.
- **Roo Code** archived in May 2026; the successor ("Roomote") has no OSS license.
- **MCP Registry** is mid-relicense with per-contribution licensing — files can't be reliably attributed to MIT vs Apache-2.0.

## Standing rules for the arc

1. Adapt-eligible ≠ blanket-safe: before porting any file, confirm that specific file's
   license header/directory (VS Code product assets, Bruno paid features, Zed's Apache
   crates are the cautionary examples).
2. Every adaptation is journaled (source project, files, license); attribution preserved;
   NOTICE updated for Apache-2.0 sources.
3. Where a Tier 1 reference already implements a planned feature well, adapting it beats
   redesigning (maintainer's rule of thumb).
