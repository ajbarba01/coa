# 0019 — coa opens the profiled browser itself; `BROWSER` only suppresses the CLI's open

- Status: accepted
- Date: 2026-07-31

Supersedes [0018](0018-isolated-browser-login-sessions.md). Everything 0018 decided about *why*
isolation exists and *where* it lives still holds — the per-account `--user-data-dir` profile, the
provider-descriptor seam, account-id keying, the global off-by-default setting, and the SC-1
fallback are all unchanged. This ADR replaces only the **launch mechanism**, and corrects two
things 0018 asserted that a live sign-in disproved.

## Context and problem

0018 chose to redirect the open through `BROWSER`: the CLI would hand coa's generated shim the
authorize url, and the shim would launch the profiled browser with it. The first real sign-in on
win32 produced a broken sign-in page, because the url never arrived intact.

## Decision drivers

- **Measured over reasoned.** 0018's mechanism was spike-confirmed for *profile isolation* but its
  url-delivery leg was never exercised against a real CLI-generated url. This one was.
- **No shell between coa and the browser.** Every failure here was a quoting failure. The fix
  should remove the class, not patch an instance.
- **SC-1 / D85 unchanged.** Any failure still degrades to copy-link + paste-code.

## Considered options

1. **Fix the shim's quoting** (`%*`, delayed expansion, a caret-aware relay). Rejected: it keeps a
   `cmd` hop on the critical path of a login, and every variant is another quoting rule to get
   right on a surface coa does not own.
2. **Point `BROWSER` at a native relay executable.** Rejected for v1 — it means shipping and
   maintaining a compiled artifact per platform to solve a problem option 3 dissolves.
3. **Split the job in two: `BROWSER` suppresses, coa opens.** Chosen.

## Decision

- `BROWSER` still points the `claude auth login` spawn at a coa-generated shim, but the shim is a
  **no-op suppressor** (`exit /b 0` / `exit 0`). Its only job is to swallow the CLI's
  default-browser fallback so a second, wrong window never appears.
- **coa performs the real open itself**, from the authorize url it captures off the CLI's own
  output, spawned as an **argv array with no shell** in the path.
- **The captured url must be stripped of OSC sequences before use.** On a TTY — which the PTY
  capture branch always is — the CLI prints the url as an OSC 8 hyperlink,
  `ESC]8;id=N;URL ESC\ URL ESC]8;;ESC\`, so the url arrives twice with only a non-whitespace
  terminator between the copies. A whitespace-delimited match captures both copies plus the
  terminator, and the resulting string rides into the browser inside the first url's `login_hint`,
  which is what the sign-in page fills its email box from. Capture becoming load-bearing is a
  direct consequence of this ADR, so the stripping requirement belongs to it.

### Corrections to 0018

**1. Why the shim cannot relay the url.** 0018 recorded the symptom correctly but named the wrong
cause. It stated that `cmd` eats everything after the url's first `&` *before the batch file runs*.
It does not — the CLI caret-escapes the url, and the full string reaches `cmd` intact:

```
cmd.exe /q /d /s /c "<shim>.cmd ^"\^"https://claude.com/cai/oauth/authorize^?code=true^&client_id=…^&login_hint=test^%40email.com\^"^""
```

The truncation happens one level further in: **`cmd`'s batch argument tokenizer treats `=` as a
delimiter**, so `%1` stops at the first one. A recorder shim reading `%~1` under delayed expansion
— which rules out the `echo`-reparsing artifact — still receives:

```
\"https://claude.com/cai/oauth/authorize?code
```

The practical conclusion 0018 drew is unaffected: a generated batch file cannot be trusted to relay
this url, and a direct argv spawn has no shell in between and is immune to the whole class.
(Whether `%*` could be recovered was not pursued — the direct open removes the need.)

**2. There are two different authorize urls, and the CLI opens the better one.** 0018's Decision
claimed "the paste-code return removes any need for localhost-callback interception." That reads
the wrong way round. In a single run the url printed to stdout and the url handed to `BROWSER`
share the same `client_id`, `code_challenge`, and `state`, and differ in exactly one parameter:

| | `redirect_uri` |
| --- | --- |
| printed to stdout (what coa captures) | `https://platform.claude.com/oauth/code/callback` → shows a code to paste back |
| handed to `BROWSER` (what the CLI opens) | `http://localhost:<ephemeral>/callback` → completes itself |

So the paste-code step is not inherent to the flow — it is an artifact of coa capturing the
*human-fallback* url. The no-paste path is a localhost callback inside the CLI process coa itself
spawned. This ADR does not decide how to reach it; it records that the option exists and that
0018's claim was wrong.

## Consequences (good / bad)

- **Good:** the url reaches the browser byte-exact, with no shell and no quoting rules coa does
  not control. Exactly one window opens.
- **Good:** the suppressor shim is trivial and stable — there is nothing left in it to get wrong.
- **Bad / cost:** the login now depends on coa's own capture of the url, which makes terminal
  escape handling load-bearing where it previously was not. The OSC 8 hyperlink form above is the
  first instance of that cost and will not be the last.
- **Bad / cost, carried forward from 0018:** per-account Chrome profiles are tens of MB and
  accumulate. Prompt-to-remove on account removal only covers logins that landed: a cancelled
  login, a failed login, and a mismatch `retry` (which mints a fresh profile id on purpose) all
  strand a populated profile dir no account row references, and `hasProfile` only reports for
  registered accounts, so the removal prompt can never reach an orphan. No pruner exists —
  deleting a directory with no account behind it is a deliberate maintainer decision, not
  something to do silently. win32-only detection in v1 (others fall back).
- **Open:** whether to pursue the localhost-callback url and drop the paste-code step. It needs
  port discovery for a process coa owns, plus a fallback when the port cannot be found, and is
  being designed separately.
- **Follow-up:** confirm in the attended run that coa's argv launch lands the right identity end to
  end — one profiled window on the full authorize url, no default-browser window beside it, and
  the sign-in completing as the declared email.
