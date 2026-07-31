# 0020 — The `BROWSER` shim is a courier: it relays the self-completing authorize url

- Status: accepted
- Date: 2026-07-31

Supersedes [0019](0019-coa-opens-the-profiled-browser.md), which supersedes
[0018](0018-isolated-browser-login-sessions.md). Everything about *why* isolation exists and
*where* it lives is unchanged from 0018; 0019's direct-argv launch is unchanged and still the
only thing that opens a browser. This ADR changes what the shim does and which url gets opened.

## Context and problem

0019 recorded two findings and drew one wrong conclusion from them.

The findings hold. The CLI generates **two different authorize urls** per run — same
`client_id`, `code_challenge`, and `state`, differing in exactly one parameter:

| | `redirect_uri` | outcome |
| --- | --- | --- |
| printed to stdout | `https://platform.claude.com/oauth/code/callback` | shows a code the user pastes back |
| handed to `BROWSER` | `http://localhost:<ephemeral>/callback` | completes itself, no code |

coa captured the printed one, so every isolated sign-in ended in a pasted code — not because
the flow requires it, but because coa was reading the human-fallback url.

The wrong conclusion was that the shim could not relay the good one. 0018 blamed `cmd` eating
past `&`; 0019 corrected the cause to batch tokenization but kept the conclusion "no shim-side
fix exists." **Both tested only `%1`.** `%1` is genuinely unusable — `cmd`'s batch argument
tokenizer treats `=` as a delimiter, so it arrives truncated at the url's first one:

```
\"https://claude.com/cai/oauth/authorize?code
```

But `%*` is the raw remainder of the command line and survives whole, including every `&`.
Measured against a real `claude auth login`, a shim reading `%*` receives the complete url with
`redirect_uri=http%3A%2F%2Flocalhost%3A58098%2Fcallback` intact.

## Decision drivers

- **The paste step is a defect, not a requirement.** A self-completing sign-in exists and coa
  was declining it by accident.
- **Don't put a command line back in a batch file.** The quoting failures that cost this
  workstream two rounds all came from a shell building a browser invocation.
- **SC-1 / D85 unchanged.** Every failure still degrades to copy-link + paste-code.

## Considered options

1. **Discover the localhost port** from the CLI process coa spawned (`netstat`/`lsof` by pid)
   and rewrite `redirect_uri` on the captured url. Rejected: needs per-platform process
   inspection, a poll for the port to appear, and it reconstructs information the shim is
   already being handed.
2. **Let the shim launch the browser** with `--user-data-dir` and the url. Rejected: it returns
   Chrome's command line to a generated batch file — the exact failure class this lineage keeps
   paying for.
3. **Courier: the shim writes the url down and exits; coa opens it.** Chosen.

## Decision

- The `BROWSER` shim becomes a **courier**. It writes its argument to
  `~/.coa/browser-profiles/<key>.url` and exits, launching nothing. It still displaces the
  CLI's own default-browser open, so the suppression 0019 relied on is preserved as a property
  of pointing `BROWSER` anywhere at all.
  - **win32:** `set "u=%*"` under `enabledelayedexpansion`, then write `!u!`. Both halves are
    load-bearing — `%*` because `%1` truncates on `=`, and delayed expansion because normal
    expansion would substitute the url's `&` into the line before parsing and reparse it as a
    command separator.
  - **POSIX:** `printf '%s' "$1"`. Neither problem ever existed there; this was always a
    win32-only defect.
- **coa opens the relayed url when it has one**, and the printed url when it does not. The
  launch itself is unchanged from 0019: argv array, no shell.
- The relayed value arrives wrapped (`"\"…\""` on win32, bare on POSIX). One reader unwraps
  both by matching a url pattern that excludes `"` and `\`, and treats anything unrecognized as
  no relay.
- **Timing is bounded, not assumed.** The shim runs when the CLI opens the browser, observably
  before it prints the fallback url — but that is the CLI's ordering, not coa's. The open waits
  a bounded number of short ticks for the file, then proceeds with the printed url.
- **Stale relays are cleared at the start of every login**, when the shim is written. A url left
  by an earlier attempt names a localhost port that died with it, and following it would send
  the sign-in to a dead callback.
- **The copy-link keeps showing the printed url.** It is the manual escape hatch and may be
  opened on another device, where a `localhost` callback is meaningless. So coa's own launch
  takes the fast path while the fallback stays portable and keeps its paste-code field.

## Consequences (good / bad)

- **Good:** an isolated sign-in completes in the browser with nothing to paste back.
- **Good:** the shim's job shrinks to copying a string to disk — too small to get the quoting
  wrong, and the proven argv launch is untouched.
- **Bad / cost:** the two urls now differ by design, so a user who ignores the opened window and
  uses the copy-link still pastes a code. Accepted deliberately in exchange for a portable
  fallback.
- **Bad / cost:** the localhost callback lives in the CLI process. If it exits early, that url
  dies and the copy-link is the only way through — the existing grace path still registers a
  handshake that completed.
- **Bad / cost, carried forward:** orphaned profile dirs still have no GC (see 0018). The
  courier file is keyed alongside the profile and removed with it, so it adds no new orphan
  class, but it inherits the existing one.
- **Process note:** this is the third ADR in one day on one mechanism. The cause was
  generalizing "batch cannot relay this" from a single experiment on `%1`. The lesson recorded
  here is narrow and worth keeping: when an experiment rules out a mechanism, name the variant
  tested, not the category.
