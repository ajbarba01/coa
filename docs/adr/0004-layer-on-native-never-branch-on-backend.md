# 0004. Layer on the native preset; composition never branches on backend

- Status: accepted
- Date: 2026-07-06

## Context and problem

An earlier decision, **D-P1**, held that coa should keep the custom-string prompt path and own the *entire*
system prompt — explicitly **not** using the Claude Agent SDK's `preset:'claude_code'` — on the theory that
full ownership was the only way to guarantee coa's authority wasn't diluted by vendor prose. D-P1 lived only in
a (deleted) scratch-notes graveyard and was never given an ADR, so there is no earlier record to mark
`superseded by`; this ADR states in one line that it **supersedes the prior D-P1 stance** and is the first
durable record of the reversal. The core-context spike (§5/§7 of
`docs/design/research/core-context-and-roles-spike.md`) reversed D-P1 as **DC-5**: owning the whole prompt means
duplicating Anthropic's own baseline conduct (tool-use policy, `file:line` citation, git safety, `<env>`
handling) and fighting a model that already does those well natively. This ADR is that reversal's permanent
home, scoped narrowly to the **backend-rendering stance** (DC-5/DC-5a) — the broader DC-1..4,6..12
composition/role model is ADR 0003's territory and is not re-captured here.

## Decision drivers

- **Don't fight the model.** Re-teaching a baseline the preset already ships correctly is pure adherence tax:
  tokens spent restating identity/tone/tool-use/environment conduct the model already follows well, for no
  governance value.
- **No-lock-in stays real only if the neutral layers stay neutral.** If composition (M2/M5) started branching
  on backend to decide what to drop, "adapter-agnostic" would quietly mean "Claude-shaped," and a bare-model
  path would inherit assumptions it can't use.
- **"Adapter-agnostic" is softened, not abandoned.** The bar moves from *provably byte-identical* across
  backends to *works well everywhere* — Claude may legitimately run richer than a bare chat-completion model,
  as long as neither path is a second-class governance target.
- **Layering reopens a risk coa had already closed once**: leaning on the SDK's own preset/setting-source
  machinery is exactly the surface that can leak the *target repo's* on-disk config (CLAUDE.md, `.claude/`
  settings, ambient MCP servers) into a governed session as unaudited authority coa never rendered.

## Considered options

1. **Keep D-P1 — own the whole prompt.** Rejected: duplicates the preset's baseline conduct piece-by-piece,
   costs tokens on every turn, and fights a model that already executes that baseline well; the earlier
   graveyard notes cite this as the reason to revisit D-P1 in the first place.
2. **Layer on the native preset, with the drop-set decided in composition** (M2/M5 knows which baseline Pieces
   to omit for a given backend). Rejected: this pushes a backend-aware branch one layer too early — the
   composition/compile layers would have to know "is this a Claude session" to decide what to emit, which is
   exactly the `if (backend === …)` branching the constitution rules out for the core.
3. **Layer on the native preset, with the drop-set applied inside `renderNative`** (chosen). Composition stays
   fully neutral and emits every Piece; only the M9 render seam — which already exists to do backend binding —
   decides what a given backend's native scaffold already covers.

## Decision

### Two-mode render (DC-5)
The M9 render seam now renders neutral config in two modes, one per backend class:

- **Claude (delta-on-native):** `packages/adapter-claude-sdk/src/sdk-options.ts`'s `buildBaseOptions` sets
  `systemPrompt: { type: 'preset', preset: 'claude_code', append: backend.systemPrompt }` (append omitted
  entirely when empty, never sent as `''`). The preset supplies Claude Code's own baseline; coa's `append` layers
  its own authority (identity, orientation, role, standing reminders) on top rather than restating the baseline.
  `render-native.ts`'s `PRESET_COVERED_PIECES` (`baseline-identity`, `baseline-tone`, `baseline-tool-use`,
  `baseline-environment`) is the drop-set filtered out of the Claude append — a **gentle non-duplication of
  generics the preset already ships, never a suppression of native behavior**: coa-specific Pieces
  (coa-orientation, pkg-coding, role sections) are never in this set because they carry authority the preset
  lacks.
- **Bare models (standalone):** `packages/adapter-deepseek/src/render.ts` and the LongCat equivalent apply no
  drop-set and emit every Piece — "a pure API has only a system message… DeepSeek has no preset to defer to, so
  it renders every Piece" (render.ts). The spike's design further calls for a **taught tool-calling convention**
  in that standalone scaffold for backends with no native function-calling. **Decided, not built as prose:** the
  two backends actually shipped (DeepSeek, LongCat) both expose native JSON-schema function-calling
  (`packages/loop-driver/src/complete.ts`'s `ToolDef.parameters` is JSON-schema, passed through as a native tool
  param), so the taught-XML-in-prose path has not yet been needed or written; it remains DC-5's fallback for a
  future backend that lacks native tool calling, not a shipped Piece today.

### Composition never branches on backend (DC-5a)
The invariant this ADR exists to record: **M2 (composition) and M5 (compile) are backend-neutral and must never
branch on backend.** They emit one neutral `NeutralConfig` — every Piece, in the DC-6 slot order, undifferentiated
by target backend. Every backend-aware choice — which Pieces a given backend's native scaffold already covers,
how tool definitions serialize (JSON schema vs. taught prose), MCP wiring — lives in **M9's `renderNative`
(`render-native.ts`) and its DeepSeek/LongCat siblings, and nowhere earlier.** `render-native.ts`'s own
comment states the shape this buys: "Pure and deterministic (P1) — the only place backend binding happens, so
swapping the backend edits this function, never M5/M8." "Adapter-agnostic" is downgraded from *provably
byte-identical* to *works well everywhere*, per the drivers above.

### The reopened config-leak risk — status: contained, built
Layering on the SDK's native preset machinery is the same surface that, left at its defaults, lets the SDK load
the **target repo's own on-disk config** (`CLAUDE.md`, `.claude/settings`, `~/.claude`) and any ambient MCP
servers as authority coa never rendered or audited — the risk the earlier pieces-phase research flagged live.
Containment is **built**, not merely planned: `sdk-options.ts`'s `buildBaseOptions` sets `settingSources: []`
and `strictMcpConfig: true` unconditionally alongside the preset, with an inline comment distinguishing the two
mechanisms — "the preset supplies Anthropic-authored baseline behavior, while `settingSources: []` blocks the
TARGET REPO's own on-disk config/MCP servers from leaking in" — and this is asserted directly in
`sdk-options.test.ts` (`expect(opts.settingSources).toEqual([])`, `expect(opts.strictMcpConfig).toBe(true)`).
Containment lives at the **M9 seam**, expressed as explicit `settingSources`/`strictMcpConfig`/`tools` control —
never as prompt ownership; D-P1's original (rejected) fix for this risk was to own the whole prompt, which this
ADR replaces with a narrower, cheaper control at the option-building seam.

## Consequences (good / bad)

**Good**
- coa stops paying an adherence tax to restate baseline conduct Claude's own preset already executes well,
  while still adding its own authority (role, orientation, standing reminders) on top.
- The backend-neutral invariant (DC-5a) holds in the shipped code: `render-native.ts` and
  `adapter-deepseek/render.ts` both consume the same `NeutralConfig` shape and neither M2 nor M5 contains a
  backend conditional — a new backend adapter can choose its own drop-set (or none) without touching upstream
  composition.
- The config-leak risk this reversal reopens is not merely acknowledged, it is closed the same way it was
  found: at the M9 option-building seam, test-asserted, rather than deferred as an open risk.

**Bad**
- The Claude and bare-model prompts are no longer close to byte-comparable — a Claude session runs on the
  vendor's own (opaque, versioned) preset content plus coa's delta, while a bare-model session runs coa's full
  standalone scaffold. Any A/B or resolve-rate comparison across backends (ADR 0003's DC-9) now compares two
  genuinely different prompt compositions, not the same prompt on different models.
- `PRESET_COVERED_PIECES` is a hand-picked, currently-untested-against-drift set: if Anthropic changes what the
  `claude_code` preset covers, the drop-set can silently fall out of sync (under-drop → duplication tax,
  over-drop → a gap neither coa nor the preset fills) with no automated signal today.
- The taught tool-calling convention DC-5 calls for on bare models without native function-calling is decided
  but unwritten; a future backend that lacks native tool calling will need it built before the "standalone"
  mode is actually complete for that backend.

---

_Last reviewed: 2026-07-06_
