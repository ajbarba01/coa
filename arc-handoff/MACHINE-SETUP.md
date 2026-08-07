# Machine setup for the coa improvement arc

Everything here is machine-specific setup that lives OUTSIDE git in normal operation.
It exists in this folder only to move the arc between machines. Do this before running
anything, or `pnpm install` will fail.

## 1. Node 22 (required)

The repo pins Node 22.20 in `.nvmrc`. A system Node 24 breaks the native module builds.

```bash
nvm install 22        # or use the exact version the old machine used: 22.22.3
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"   # prepend before any pnpm/node command
node --version        # must print v22.x
```

Every arc command (and every subagent prompt) should prepend that `export` line — the
old run baked it into every prompt because a stale PATH silently reintroduces Node 24.

## 2. node-gyp vs Python 3.14 (required if your system Python is 3.13+)

`node-gyp` 9.4.1 imports `distutils`, which Python 3.12+ removed. Symptom:
`ModuleNotFoundError: No module named 'distutils'` while building `better-sqlite3`,
`tree-sitter`, or `node-pty`. Fix with a dedicated venv holding an old-enough
setuptools, then point npm at it:

```bash
python3 -m venv ~/dev/coa-arc/.gyp-python
~/dev/coa-arc/.gyp-python/bin/pip install 'setuptools<81'
printf 'python=%s/dev/coa-arc/.gyp-python/bin/python\n' "$HOME" > ~/dev/coa/.npmrc
```

`repo-local-files/npmrc.example` is the old machine's version of that file — the path
inside it is absolute, so regenerate rather than copy it verbatim.

If your Python is 3.11 or older you can skip this entirely and delete the `.npmrc`.

## 3. Gitignored repo files to restore

Copy these into the clone and keep them out of git (the old machine used
`.git/info/exclude`, which is per-clone and does NOT travel with a push):

```bash
cd ~/dev/coa
cp <handoff>/repo-local-files/CLAUDE.local.md  ./CLAUDE.local.md
mkdir -p .claude && cp <handoff>/repo-local-files/settings.local.json ./.claude/settings.local.json
cat >> .git/info/exclude <<'EOF'
CLAUDE.local.md
.claude/settings.local.json
.npmrc
.arc-shots/
EOF
mkdir -p .arc-shots
```

- **`CLAUDE.local.md`** carries the org-prompt hygiene directive (this is a personal
  project; the employer system prompt does not apply here; no employer references in
  any committed artifact). Every subagent prompt the arc writes repeats that line.
- **`settings.local.json`** is the permission allowlist the old machine tuned so an
  unattended run never prompts. Two learnings baked into it: `Write(path)` rules are
  not matched by the harness (`Edit(//Users/...)` covers all file-editing tools), and
  Bash file-writes OUTSIDE the workspace get path-checked regardless of command rules —
  which is why scratch output and screenshots go to `~/dev/coa/.arc-shots/` (gitignored)
  rather than `/tmp`. Adjust the absolute paths for your home directory.
- **`.arc-shots/`** is where UI screenshots go for the visual gate.

## 4. Skills (both were installed globally on the old machine)

```bash
git clone https://github.com/pbakaus/impeccable.git      ~/.claude/skills/impeccable
git clone https://github.com/DietrichGebert/ponytail.git ~/.claude/skills/ponytail
```

Old-machine commits: impeccable `aee6ce9`, ponytail `16f2980`. Verify they list in a
fresh session inside `~/dev/coa` before the UI stages.

## 5. Verify the setup

```bash
cd ~/dev/coa
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
pnpm install --frozen-lockfile     # native modules must build: better-sqlite3, tree-sitter, node-pty
pnpm check && pnpm docs:check      # typecheck · lint · format · vitest · depcruise · docs router
```

**Run the test suite unsandboxed.** The Claude-adapter control probes spawn real child
processes; a sandboxed shell makes ~5 of them time out and look like real failures.

Expected at `arc/architecture` (0fe96d1): all gates green, ~2885 tests passing,
depcruise clean over ~414 modules, docs-check 59 docs.
