// Archived (exploratory half) from
// packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.test.ts.
// These probes measured levers no shipped code uses: compaction control
// (settings switches, hook vetoes, programmatic triggers) and SDK-side session
// state ownership (sessionStore, file checkpointing, config-dir redirection).
// Shipped code uses only `resume` plus its own append-only log; the `--resume`
// argv-mapping probe and the mid-session-channel probes stay in the in-tree
// file, along with the `captureSpawn`/`captureStdin`/`readSdkTypings` helpers
// these probes ran on.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  query,
  type SessionKey,
  type SessionStoreEntry,
  type Settings,
} from '@anthropic-ai/claude-agent-sdk';

describe('stage 5 — context over time: is compaction reachable from outside?', () => {
  it('sends no compaction lever on argv for a default session', async () => {
    // The negative probe behind "coa has no argv-level control of compaction by default".
    const capture = await captureSpawn({ settingSources: [] });
    const compactionFlags = capture.argv.filter((arg) => /compact|context|summar/i.test(arg));
    expect(compactionFlags).toEqual([]);
  });

  it('does route a compaction switch to the wire, through the settings layer', async () => {
    // `Settings.autoCompactEnabled` is documented as "Automatically compact conversation when
    // context fills". `Options.settings` serialises the whole object onto `--settings`, so the
    // switch demonstrably REACHES the CLI. Whether the CLI honours it is a live question
    // (stage-5-6-lifecycle.live.test.ts) — argv proves delivery, not effect.
    const capture = await captureSpawn({
      settingSources: [],
      settings: { autoCompactEnabled: false, autoCompactWindow: 100_000 },
    });
    expect(capture.hasFlag('--settings')).toBe(true);
    expect(
      capture.json<{ autoCompactEnabled: boolean; autoCompactWindow: number }>('--settings'),
    ).toEqual({
      autoCompactEnabled: false,
      autoCompactWindow: 100_000,
    });
  });

  it('routes the same key through managedSettings onto a separate flag', async () => {
    // A second, higher-precedence delivery path. Note the SDK does not filter here: the
    // restrictive-only filtering documented for `managedSettings` happens CLI-side, so this
    // probe shows delivery only — `autoCompactEnabled` may well be dropped as non-allowlisted.
    const capture = await captureSpawn({
      settingSources: [],
      managedSettings: { autoCompactEnabled: false },
      settings: { autoCompactEnabled: false },
    });
    expect(capture.json<{ autoCompactEnabled: boolean }>('--managed-settings')).toEqual({
      autoCompactEnabled: false,
    });
    expect(capture.json<{ autoCompactEnabled: boolean }>('--settings')).toEqual({
      autoCompactEnabled: false,
    });
  });

  it('will put any invented flag on the wire via extraArgs, which settles nothing', async () => {
    // Recorded to close off a tempting false lead: `extraArgs` is an unvalidated pass-through,
    // so `--no-compact` appearing on argv is evidence about the SDK, not about the CLI. There
    // is no offline way to learn whether the CLI has such a flag; that is the binary track's.
    const capture = await captureSpawn({ settingSources: [], extraArgs: { 'no-compact': null } });
    expect(capture.argv).toContain('--no-compact');
  });

  it('does not validate the settings object at all', async () => {
    // Two levels of non-validation, both relevant to whether coa can rely on this channel:
    // `Settings` carries a top-level index signature, so an unknown key is not even a type
    // error, and the SDK ships whatever it is given. A settings key that the CLI has quietly
    // renamed will therefore fail silently rather than loudly — which is why the live probe
    // reads `isAutoCompactEnabled` back rather than trusting the send.
    // Asserted at the TYPE level rather than by pattern-matching the typings: if the
    // top-level index signature is ever removed, this stops compiling, which is a louder
    // and more durable tripwire than a regex over a 6000-line .d.ts.
    const unknownKeyIsNotATypeError: Settings = { thisKeyDoesNotExist: true };
    expect(unknownKeyIsNotATypeError['thisKeyDoesNotExist']).toBe(true);
    const capture = await captureSpawn({
      settingSources: [],
      settings: { thisKeyDoesNotExist: true },
    });
    expect(capture.json<Record<string, unknown>>('--settings')).toEqual({
      thisKeyDoesNotExist: true,
    });
  });

  it('exposes PreCompact and PostCompact as real hook events at runtime', () => {
    // A runtime constant, not a type — this one is safe to lean on.
    expect(HOOK_EVENTS).toContain('PreCompact');
    expect(HOOK_EVENTS).toContain('PostCompact');
  });

  it('puts nothing about hooks on argv — registration is protocol-level', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      hooks: { PreCompact: [{ hooks: [async () => ({ continue: true })] }] },
    });
    expect(capture.argv.filter((arg) => /hook/i.test(arg))).toEqual([]);
  });

  it('registers the compaction hooks in the initialize control request', async () => {
    // The protocol-level counterpart to the probe above: the harness IS told coa wants these
    // events. This is the strongest offline evidence that compaction is at least observable.
    const frames = await captureStdin(
      {
        settingSources: [],
        hooks: {
          PreCompact: [{ hooks: [async () => ({ continue: true })] }],
          PostCompact: [{ hooks: [async () => ({ continue: true })] }],
        },
      },
      [],
    );
    const initialize = frames.find(
      (frame) =>
        isRecord(frame) &&
        frame['type'] === 'control_request' &&
        isRecord(frame['request']) &&
        frame['request']['subtype'] === 'initialize',
    );
    expect(initialize).toBeDefined();
    const request = isRecord(initialize) ? initialize['request'] : undefined;
    const hooks = isRecord(request) ? request['hooks'] : undefined;
    expect(isRecord(hooks) ? Object.keys(hooks).sort() : undefined).toEqual([
      'PostCompact',
      'PreCompact',
    ]);
    // Callbacks cross as opaque ids the CLI calls back on; the handler runs SDK-side.
    expect(JSON.stringify(hooks)).toContain('hookCallbackIds');
  });

  it('carries no compaction configuration in the initialize request', async () => {
    // Negative probe: the only compaction knob the SDK will deliver is the settings layer
    // above. `initialize` itself does not negotiate compaction.
    const frames = await captureStdin({ settingSources: [] }, []);
    const initialize = frames.find(
      (frame) =>
        isRecord(frame) &&
        frame['type'] === 'control_request' &&
        isRecord(frame['request']) &&
        frame['request']['subtype'] === 'initialize',
    );
    expect(JSON.stringify(initialize)).not.toMatch(/compact/i);
  });

  it('gives a PreCompact handler no channel to shape or veto the compaction', () => {
    // THE decisive structural finding for compaction control. Every hook event that can
    // influence its subject does so through a `<Event>HookSpecificOutput` member of
    // `SyncHookJSONOutput`. There is no `PreCompactHookSpecificOutput` and no
    // `PostCompactHookSpecificOutput` in the shipped typings at all, so the richest thing a
    // PreCompact handler may return is the generic envelope (`continue` / `decision` /
    // `systemMessage` / `reason`).
    //
    // Note the asymmetry that makes this readable as intent rather than omission: PreToolUse —
    // the event that IS allowed to veto and rewrite — has `permissionDecision` and
    // `updatedInput` on its specific output. PreCompact has no specific output to put them on.
    const typings = readSdkTypings();
    expect(typings).toContain('PreCompactHookInput');
    expect(typings).toContain('PostCompactHookInput');
    expect(typings).not.toContain('PreCompactHookSpecificOutput');
    expect(typings).not.toContain('PostCompactHookSpecificOutput');
    expect(typings).toContain('PreToolUseHookSpecificOutput');
    expect(typings).toMatch(/permissionDecision\?: HookPermissionDecision/);
  });

  it('hands PreCompact the compaction instructions as input it cannot answer', () => {
    // `custom_instructions` arrives on the INPUT (it is what `/compact <instructions>` carried).
    // Combined with the probe above — no specific output — coa can read the instructions
    // driving a compaction but has no typed way to supply or amend them.
    const typings = readSdkTypings();
    expect(typings).toMatch(
      /hook_event_name: 'PreCompact';\s*trigger: 'manual' \| 'auto';\s*custom_instructions: string \| null;/,
    );
    expect(typings).toMatch(/hook_event_name: 'PostCompact';\s*trigger: 'manual' \| 'auto';/);
    expect(typings).toContain('compact_summary: string;');
  });

  it('offers no programmatic compaction trigger or disable on the Query handle', async () => {
    // Negative probe. `Query` is where mid-session control requests live (`setModel`,
    // `interrupt`, `setPermissionMode`). Compaction is absent from it.
    const controller = new AbortController();
    const q = query({
      prompt: 'probe',
      options: {
        settingSources: [],
        abortController: controller,
        spawnClaudeCodeProcess: () => recordingProcess([]),
      },
    });
    const handle = q as unknown as Record<string, unknown>;
    expect(typeof handle['compact']).toBe('undefined');
    expect(typeof handle['setCompactionEnabled']).toBe('undefined');
    expect(typeof handle['disableAutoCompact']).toBe('undefined');
    // What IS there: a mid-session settings merge, and a read of the threshold.
    expect(typeof handle['applyFlagSettings']).toBe('function');
    expect(typeof handle['getContextUsage']).toBe('function');
    controller.abort();
    try {
      await q.return();
    } catch {
      // Expected.
    }
  });

  it('surfaces compaction in-band, with enough detail to reconcile a transcript', () => {
    // Structural: `SDKCompactBoundaryMessage` is a member of the `SDKMessage` union coa already
    // iterates, and carries the token counts and the surviving-message uuids. This is what
    // makes the verdict "Observed" rather than "Opaque". The live probe asserts the real frame.
    const typings = readSdkTypings();
    expect(typings).toMatch(/export declare type SDKMessage = .*SDKCompactBoundaryMessage/);
    expect(typings).toContain("subtype: 'compact_boundary'");
    expect(typings).toContain('pre_tokens: number;');
    expect(typings).toContain('preserved_messages?:');
    // And the running status, including a compaction that FAILED.
    expect(typings).toContain(
      "export declare type SDKStatus = 'compacting' | 'requesting' | null;",
    );
    expect(typings).toContain("compact_result?: 'success' | 'failed';");
    // And the threshold read, so coa can see it coming rather than only after the fact.
    expect(typings).toContain('isAutoCompactEnabled: boolean;');
    expect(typings).toContain('autoCompactThreshold?: number;');
  });
});

describe('stage 6 — state ownership: where does the session actually live? (archived probes)', () => {
  it('does not enforce the documented sessionId/resume exclusivity', async () => {
    // `Options.sessionId` is documented "Cannot be used with `continue` or `resume` unless
    // `forkSession` is also set". The SDK does not check: both flags ship and the CLI decides.
    // Recorded because coa must not rely on the SDK to catch that combination for it.
    const capture = await captureSpawn({
      settingSources: [],
      resume: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
    });
    expect(capture.flag('--resume')).toBe('11111111-1111-4111-8111-111111111111');
    expect(capture.flag('--session-id')).toBe('22222222-2222-4222-8222-222222222222');
    expect(capture.argv).not.toContain('--fork-session');
  });

  it('delivers file checkpointing through the environment, not argv', async () => {
    // The ambient process may already carry this variable (a Claude Code session sets it for
    // its own children), so the probe controls for that before attributing it.
    const key = 'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING';
    const saved = process.env[key];
    delete process.env[key];
    try {
      const omitted = await captureSpawn({ settingSources: [] });
      expect(omitted.env[key]).toBeUndefined();
      expect(omitted.argv.filter((arg) => /checkpoint/i.test(arg))).toEqual([]);

      const explicitlyOff = await captureSpawn({
        settingSources: [],
        enableFileCheckpointing: false,
      });
      expect(explicitlyOff.env[key]).toBeUndefined();

      const on = await captureSpawn({ settingSources: [], enableFileCheckpointing: true });
      expect(on.env[key]).toBe('true');
      expect(on.argv.filter((arg) => /checkpoint/i.test(arg))).toEqual([]);
    } finally {
      if (saved !== undefined) process.env[key] = saved;
    }
  });

  it('flips a mode flag for sessionStore but carries the data off-argv', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      sessionStore: { append: async () => {}, load: async () => null },
      sessionStoreFlush: 'eager',
    });
    expect(capture.argv).toContain('--session-mirror');
    // The store itself is an in-process callback object; nothing about it is serialisable, so
    // the flush strategy and the adapter never appear on the command line.
    expect(capture.hasFlag('--session-store')).toBe(false);
    expect(capture.argv.filter((arg) => /eager|batched/.test(arg))).toEqual([]);
  });

  it('reads the whole resume history out of coa store, before the process is spawned', async () => {
    // This is the probe behind "coa can own the read path". `load()` is called in the SDK
    // parent with a key coa can compute, and coa returns whatever it likes.
    // The default projectKey is the cwd with every non-alphanumeric character replaced by a
    // dash — derived here rather than hardcoded so the probe survives a different checkout.
    const projectKey = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
    const calls: string[] = [];
    const entry: SessionStoreEntry = {
      type: 'user',
      uuid: '33333333-3333-4333-8333-333333333333',
      timestamp: '2026-08-02T00:00:00.000Z',
      message: { role: 'user', content: 'reconstructed by coa from its own log' },
    };
    const capture = await captureSpawn({
      settingSources: [],
      resume: '11111111-1111-4111-8111-111111111111',
      sessionStore: {
        append: async () => {
          calls.push('append');
        },
        load: async (key: SessionKey) => {
          calls.push(`load:${key.projectKey}:${key.sessionId}:${String(key.subpath)}`);
          return [entry];
        },
        listSubkeys: async () => {
          calls.push('listSubkeys');
          return [];
        },
      },
    });

    expect(calls).toEqual([
      `load:${projectKey}:11111111-1111-4111-8111-111111111111:undefined`,
      'listSubkeys',
    ]);

    // ...and the SDK materialises coa entries into a THROWAWAY config dir, so the CLI reads
    // a transcript coa authored rather than one it kept for itself.
    const configDir = capture.env['CLAUDE_CONFIG_DIR'];
    expect(configDir).toMatch(/claude-resume-/);
    try {
      const transcript = join(
        String(configDir),
        'projects',
        projectKey,
        '11111111-1111-4111-8111-111111111111.jsonl',
      );
      expect(existsSync(transcript)).toBe(true);
      const lines = readFileSync(transcript, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual(entry);
    } finally {
      // The materialised dir also receives a COPY OF THE USER'S CREDENTIALS FILE (observed:
      // `.credentials.json` with a live OAuth token, in the system temp dir, left behind when
      // the spawn fails). The probe cleans up after itself; the leak itself is a finding.
      if (configDir !== undefined && configDir !== '')
        rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('redirects the config dir only on the resume path', async () => {
    // Bounding the previous finding: the redirect is a resume-materialisation mechanism, not a
    // general "coa owns the config dir" lever. Without a resume, the CLI writes where it likes.
    const saved = process.env['CLAUDE_CONFIG_DIR'];
    delete process.env['CLAUDE_CONFIG_DIR'];
    try {
      const storeOnly = await captureSpawn({
        settingSources: [],
        sessionStore: { append: async () => {}, load: async () => null },
      });
      expect(storeOnly.env['CLAUDE_CONFIG_DIR']).toBeUndefined();

      const resumeOnly = await captureSpawn({
        settingSources: [],
        resume: '11111111-1111-4111-8111-111111111111',
      });
      expect(resumeOnly.env['CLAUDE_CONFIG_DIR']).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env['CLAUDE_CONFIG_DIR'] = saved;
    }
  });

  it('refuses to let coa be the only writer', async () => {
    // The ceiling on stage 6. A local on-disk write is structurally required: the mirror hook
    // fires after it. coa can redirect that write and mirror it, but cannot eliminate it, so
    // "coa owns persistence outright" is false on this version.
    await expect(
      captureSpawn({
        settingSources: [],
        persistSession: false,
        sessionStore: { append: async () => {}, load: async () => null },
      }),
    ).rejects.toThrow(/sessionStore cannot be used with persistSession: false/);
  });

  it('documents append as a mirror of an already-durable local write', () => {
    // The doc half of the probe above, pinned so a future SDK bump that changes the ordering
    // (and with it the verdict) fails here rather than silently.
    const typings = readSdkTypings();
    expect(typings).toMatch(/Called AFTER the subprocess's\s*\*\s*local write succeeds/);
    expect(typings).toMatch(/the subprocess\s*\*\s*still writes to CLAUDE_CONFIG_DIR/);
  });

  it('treats a store entry as an opaque blob whose real shape is CLI-internal', () => {
    // Why the read path is `Shaped` rather than `Owned` for RECONSTRUCTION specifically: coa can
    // round-trip entries it captured from `append()`, but the entry union is explicitly not part
    // of the SDK API, so synthesising a transcript from a foreign backend is unsupported —
    // exactly the constraint history-preamble.ts works around today.
    const typings = readSdkTypings();
    expect(typings).toMatch(
      /That union is CLI-internal and not part\s*\*\s*of the SDK API surface/,
    );
    expect(typings).toMatch(/export declare type SessionStoreEntry = \{\s*type: string;/);
  });

  it('ships out-of-band session tools that read and write the store without a query', () => {
    // Stage-6 surface coa does not use yet: whole-session operations that take a `sessionStore`
    // and never spawn the CLI. Listed as evidence for the ledger's consequence column.
    const typings = readSdkTypings();
    for (const fn of [
      'importSessionToStore',
      'getSessionMessages',
      'listSessions',
      'forkSession',
      'deleteSession',
      'foldSessionSummary',
    ]) {
      expect(typings).toContain(`export declare function ${fn}(`);
    }
    expect(typings).toContain('export declare class InMemorySessionStore implements SessionStore');
    expect(typings).toMatch(/sessionStore\?: SessionStore;\s*\}/);
  });
});
