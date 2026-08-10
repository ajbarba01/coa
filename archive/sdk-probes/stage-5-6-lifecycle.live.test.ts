// Archived (exploratory half) from
// packages/adapter-claude-sdk/src/control/stage-5-6-lifecycle.live.test.ts.
// These live probes drove compaction and the SDK-side session store — levers no
// shipped code uses (shipped code resumes by id and keeps its own append-only
// log). The `BASE`/`collect` helpers they ran on remain in the in-tree file,
// which keeps the two mid-session-channel probes shipped rendering relies on.
//
// ## Cost
//
// `drives a session into an automatic compaction` was the single most expensive
// probe in the suite, because forcing an auto-compaction means filling the
// context window.
//
// It is written to try the CHEAP path first: `settings.autoCompactWindow` is a
// documented setting ("Auto-compact window size") that the offline suite proved
// reaches the CLI on `--settings`. If the CLI honours a small window, compaction
// triggers after a few thousand tokens and the probe costs cents.
// `SMALL_CONTEXT_WINDOW` below is that attempt.
//
// If it does not honour it — assert the fallback branch, do not silently pass —
// the probe must fill a real window instead: on a 200k-token model with
// auto-compact firing around 90-95% capacity, that is roughly 180k input tokens,
// reached by reading a large file repeatedly. With prompt caching most of that
// re-reads at cache-read rates, but budget **several US dollars and 10-20
// minutes of wall clock** for one run, and expect it to consume a visible slice
// of a 5-hour rate-limit window. Run it deliberately, once, and record the
// frames — do not leave it in a loop and do not run it to "check something
// small".
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type SDKUserMessage,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';

/** The cheap attempt at forcing compaction. See the cost note above. */
const SMALL_CONTEXT_WINDOW = 8_000;

/**
 * A throwaway `CLAUDE_CONFIG_DIR` that can still authenticate.
 *
 * FINDING, and the reason this helper has to exist: a config dir holds BOTH the credentials
 * (`.credentials.json`) and the session store (`sessions/`, `projects/`). `CLAUDE_CONFIG_DIR`
 * is therefore one lever doing two jobs, and pointing it at an empty directory to isolate the
 * store also throws the login away — every probe below that tried it failed with "Not logged
 * in", which is an auth failure and never a finding.
 *
 * That qualifies the stage-6 verdict directly: coa cannot redirect where local session state
 * lands without also relocating the account it authenticates as. Seeding the credential files
 * is what separates the two concerns, and is what these probes need to measure the store at all.
 */
function seededConfigDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const source = resolveLiveLocator();
  if (source.type !== 'config-dir') {
    throw new Error(`seededConfigDir: expected a config-dir locator, got ${source.type}`);
  }
  for (const file of ['.credentials.json', '.claude.json']) {
    const from = join(source.dir, file);
    if (existsSync(from)) copyFileSync(from, join(dir, file));
  }
  return dir;
}

/** An in-memory store that records every entry the CLI mirrors, so a probe can replay it. */
function recordingStore(): SessionStore & { entries: SessionStoreEntry[]; loads: SessionKey[] } {
  const entries: SessionStoreEntry[] = [];
  const loads: SessionKey[] = [];
  return {
    entries,
    loads,
    append: async (_key: SessionKey, batch: SessionStoreEntry[]) => {
      entries.push(...batch);
    },
    load: async (key: SessionKey) => {
      loads.push(key);
      return entries.length === 0 ? null : entries;
    },
    listSubkeys: async () => [],
  };
}

describe.skipIf(!LIVE)(
  'stage 5 live — does compaction actually happen, and can coa touch it?',
  () => {
    it(
      'drives a session into an automatic compaction and records what coa is told',
      async () => {
        // EXPENSIVE — read the cost note at the top of this file before running.
        //
        // The hypothesis under test: compaction fires without coa asking, coa is notified through
        // BOTH the PreCompact/PostCompact hooks and an in-band `compact_boundary` frame, and coa
        // cannot stop it. If any of those three is false, rewrite the assertion to match what was
        // observed and report that the expectation failed.
        const seen: Array<{ event: string; payload: unknown }> = [];
        const messages = await collect(
          'Read package.json, then summarise every file under packages/ one by one, in detail. ' +
            'Do not stop until you have covered all of them.',
          {
            ...BASE,
            tools: ['Read', 'Glob'],
            settings: { autoCompactWindow: SMALL_CONTEXT_WINDOW, autoCompactEnabled: true },
            includeHookEvents: true,
            hooks: {
              PreCompact: [
                {
                  hooks: [
                    async (input) => {
                      seen.push({ event: 'PreCompact', payload: input });
                      // The decisive attempt: the ONLY veto vocabulary a PreCompact handler has,
                      // since the offline suite proved there is no PreCompactHookSpecificOutput.
                      // If compaction happens anyway, stage 5 is Observed, not Owned.
                      return { continue: false, decision: 'block', stopReason: 'coa owns context' };
                    },
                  ],
                },
              ],
              PostCompact: [
                {
                  hooks: [
                    async (input) => {
                      seen.push({ event: 'PostCompact', payload: input });
                      return { continue: true };
                    },
                  ],
                },
              ],
            },
          },
        );

        const boundaries = messages.filter(
          (message) => message.type === 'system' && message.subtype === 'compact_boundary',
        );

        // 1. Compaction happened at all. If this fails, the cheap window lever did not work and
        //    the probe must be re-run on the expensive path (remove `settings` and let the real
        //    window fill) before any stage-5 verdict is written.
        expect(
          boundaries.length,
          'no compact_boundary frame — the small autoCompactWindow did not force a compaction; ' +
            're-run on the expensive path before concluding anything',
        ).toBeGreaterThan(0);

        // 2. The hooks fired, and PreCompact ran BEFORE the boundary.
        expect(seen.map((s) => s.event)).toContain('PreCompact');
        expect(seen.map((s) => s.event)).toContain('PostCompact');
        expect(seen[0]?.event).toBe('PreCompact');

        // 3. PreCompact's veto vocabulary did NOT prevent it. This is the assertion that decides
        //    Observed vs Owned. If compaction was in fact prevented, invert this and report it —
        //    it would be the most consequential finding in the spike.
        expect(
          boundaries.length,
          'PreCompact returned continue:false + decision:block and compaction happened anyway',
        ).toBeGreaterThan(0);

        // 4. What coa is actually told: trigger, token counts, and which messages survived.
        const boundary = boundaries[0];
        expect(boundary).toBeDefined();
        if (
          boundary !== undefined &&
          boundary.type === 'system' &&
          boundary.subtype === 'compact_boundary'
        ) {
          expect(boundary.compact_metadata.trigger).toBe('auto');
          expect(boundary.compact_metadata.pre_tokens).toBeGreaterThan(0);
        }

        // 5. And what PostCompact carries: the summary that replaced the dropped turns. coa needs
        //    this to be non-empty for "coa can at least record what the model kept" to hold.
        const post = seen.find((s) => s.event === 'PostCompact')?.payload;
        expect(post).toMatchObject({ hook_event_name: 'PostCompact', trigger: 'auto' });
        expect(typeof (post as { compact_summary?: unknown }).compact_summary).toBe('string');
      },
      30 * 60_000,
    );

    it(
      'reports whether autoCompactEnabled:false is honoured by the CLI',
      async () => {
        // Cheap. The offline suite proved the switch reaches `--settings`; this asks the CLI what
        // it did with it, via the control request that reads back the effective state.
        let usage: { isAutoCompactEnabled: boolean; autoCompactThreshold?: number } | undefined;
        await collect(
          'Reply with the single word: ok',
          {
            ...BASE,
            settings: { autoCompactEnabled: false },
          },
          async (q) => {
            usage = await q.getContextUsage();
          },
        );
        // HYPOTHESIS: the setting is honoured, so compaction is disable-able and stage 5 is
        // Shaped rather than merely Observed. If this reads `true`, the setting is ignored on
        // the SDK path and the verdict drops to Observed — rewrite and report.
        expect(usage?.isAutoCompactEnabled).toBe(false);
      },
      5 * 60_000,
    );

    it(
      'reports whether applyFlagSettings can toggle compaction mid-session',
      async () => {
        // Cheap. `Query.applyFlagSettings` merges into the same flag-settings layer as
        // `Options.settings`, so if the setting is honoured at all it should be togglable live —
        // which would give coa a per-turn lever rather than a session-start-only one.
        const readings: Array<boolean | undefined> = [];
        await collect('Reply with the single word: ok', { ...BASE }, async (q) => {
          readings.push((await q.getContextUsage()).isAutoCompactEnabled);
          await q.applyFlagSettings({ autoCompactEnabled: false });
          readings.push((await q.getContextUsage()).isAutoCompactEnabled);
          await q.applyFlagSettings({ autoCompactEnabled: null });
          readings.push((await q.getContextUsage()).isAutoCompactEnabled);
        });
        expect(readings).toEqual([true, false, true]);
      },
      5 * 60_000,
    );

    it(
      'reports whether coa can trigger a compaction it chose the moment for',
      async () => {
        // The offline suite proved `Query` has no `compact()`. `PreCompactHookInput.trigger`
        // nonetheless has a `'manual'` arm, which on the CLI means the `/compact` command. If a
        // streamed `/compact` turn fires PreCompact with trigger:'manual', coa can at least
        // CHOOSE WHEN compaction happens even though it cannot prevent it — a meaningfully
        // better stage-5 answer than pure observation.
        const triggers: string[] = [];
        async function* turns(): AsyncGenerator<SDKUserMessage> {
          yield {
            type: 'user',
            message: { role: 'user', content: 'Say ok.' },
            parent_tool_use_id: null,
          };
          yield {
            type: 'user',
            message: { role: 'user', content: '/compact focus on what coa asked for' },
            parent_tool_use_id: null,
          };
        }
        const messages = await collect(turns(), {
          ...BASE,
          hooks: {
            PreCompact: [
              {
                hooks: [
                  async (input) => {
                    if (input.hook_event_name === 'PreCompact') {
                      triggers.push(`${input.trigger}:${String(input.custom_instructions)}`);
                    }
                    return { continue: true };
                  },
                ],
              },
            ],
          },
        });
        // CONFIRMED, and this is the better half of the stage-5 answer: a streamed `/compact`
        // turn fires PreCompact with trigger 'manual', and the instructions coa typed reach the
        // hook verbatim. coa cannot VETO a compaction, but it can choose the moment and shape
        // what survives — which is a real lever, not pure observation.
        expect(triggers.some((t) => t.startsWith('manual:'))).toBe(true);
        expect(triggers.join(' ')).toContain('focus on what coa asked for');

        // OBSERVED, correcting the original expectation: no `compact_boundary` frame accompanies
        // a manual trigger here. The likely reason is that a two-turn session has nothing worth
        // compacting, so the hook fires on the request while no compaction is performed — which
        // means the hook firing is NOT by itself evidence that context was rewritten. Anything
        // reconciling a transcript has to read the boundary frame, not the hook.
        const boundaries = messages.filter(
          (m) => m.type === 'system' && m.subtype === 'compact_boundary',
        );
        expect(
          boundaries,
          `compact_boundary frames = ${boundaries.length}; triggers = ${JSON.stringify(triggers)}`,
        ).toHaveLength(0);
      },
      10 * 60_000,
    );
  },
);

describe.skipIf(!LIVE)('stage 6 live — can coa be the session store?', () => {
  it(
    'reconstructs a session from coa own log, with the local store thrown away',
    async () => {
      // The decisive stage-6 probe. Two sessions:
      //   1. Run a turn with a `sessionStore` and a THROWAWAY CLAUDE_CONFIG_DIR. coa keeps
      //      every mirrored entry.
      //   2. Delete that config dir entirely, then resume from coa entries alone.
      // If the model recalls the fact from turn 1, coa append-only log is a sufficient
      // substrate for session continuity and the harness's own store is disposable.
      const store = recordingStore();
      const configDir = seededConfigDir('coa-stage6-');
      const sessionId = '55555555-5555-4555-8555-555555555555';
      const secret = 'orange-lantern-9902';

      try {
        await collect(`Remember this pass phrase exactly: ${secret}. Reply "stored".`, {
          ...BASE,
          sessionId,
          sessionStore: store,
          sessionStoreFlush: 'eager',
          env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        });

        expect(store.entries.length, 'the CLI mirrored nothing to coa store').toBeGreaterThan(0);

        // Throw the harness's own copy away. Anything the resume recovers came from coa.
        rmSync(configDir, { recursive: true, force: true });
        expect(readdirSync(tmpdir()).includes(configDir)).toBe(false);

        const resumed = await collect('What pass phrase did I ask you to remember?', {
          ...BASE,
          resume: sessionId,
          sessionStore: store,
        });

        expect(store.loads.map((k) => k.sessionId)).toContain(sessionId);
        const answer = resumed
          .filter((m) => m.type === 'assistant')
          .map((m) => JSON.stringify(m.message.content))
          .join(' ');
        expect(answer).toContain(secret);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    },
    15 * 60_000,
  );

  it(
    'reports whether the CLI accepts a transcript entry coa synthesised rather than mirrored',
    async () => {
      // The stronger claim, and the one that would make the SDK ingest a FOREIGN transcript
      // (what history-preamble.ts works around today). `SessionStoreEntry` is documented as an
      // opaque blob over a CLI-internal union, so this may well fail — that failure is the
      // finding, and it is why history-preamble.ts stays.
      const secret = 'violet-anchor-3318';
      const sessionId = '66666666-6666-4666-8666-666666666666';
      const synthetic: SessionStoreEntry[] = [
        {
          type: 'user',
          uuid: '77777777-7777-4777-8777-777777777777',
          timestamp: new Date().toISOString(),
          sessionId,
          cwd: process.cwd(),
          parentUuid: null,
          message: { role: 'user', content: `Remember this pass phrase exactly: ${secret}` },
        },
        {
          type: 'assistant',
          uuid: '88888888-8888-4888-8888-888888888888',
          timestamp: new Date().toISOString(),
          sessionId,
          cwd: process.cwd(),
          parentUuid: '77777777-7777-4777-8777-777777777777',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Stored.' }] },
        },
      ];
      const store: SessionStore = {
        append: async () => {},
        load: async () => synthetic,
        listSubkeys: async () => [],
      };

      const messages = await collect('What pass phrase did I ask you to remember?', {
        ...BASE,
        resume: sessionId,
        sessionStore: store,
      });
      const answer = messages
        .filter((m) => m.type === 'assistant')
        .map((m) => JSON.stringify(m.message.content))
        .join(' ');
      // HYPOTHESIS: this works — the on-disk format is close enough to what the probe writes.
      // If it does not, report the CLI's error verbatim; "coa may replay only what it mirrored"
      // is a materially weaker and equally reportable answer.
      expect(answer).toContain(secret);
    },
    10 * 60_000,
  );

  it(
    'reports whether persistSession:false really leaves nothing behind',
    async () => {
      // The offline suite proved `--no-session-persistence` reaches the CLI. This asks whether
      // the session file is genuinely absent afterwards — the difference between "coa can run
      // ephemerally" and "coa must clean up after the harness".
      const configDir = seededConfigDir('coa-stage6-nopersist-');
      try {
        await collect('Reply with the single word: ok', {
          ...BASE,
          persistSession: false,
          env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        });
        const projects = join(configDir, 'projects');
        const written = readdirSync(configDir);
        expect(
          written.includes('projects') ? readdirSync(projects) : [],
          `persistSession:false still wrote under ${projects}`,
        ).toEqual([]);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    },
    10 * 60_000,
  );

  it(
    'reports what enableFileCheckpointing writes, and where',
    async () => {
      // Stage 6's remaining unknown. The offline suite showed it is delivered as an env var and
      // never as a flag, so only a live run can say what appears on disk and whether
      // `rewindFiles` works against a coa-driven session.
      const configDir = seededConfigDir('coa-stage6-ckpt-');
      try {
        const scratch = join(configDir, 'scratch.txt');
        const messages = await collect(
          `Create the file ${scratch} containing the word alpha, then change it to beta.`,
          {
            ...BASE,
            tools: ['Read', 'Write', 'Edit'],
            enableFileCheckpointing: true,
            env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
          },
        );
        const firstUser = messages.find((m) => m.type === 'user');
        expect(firstUser).toBeDefined();
        // Record the on-disk footprint rather than guessing at it.
        const footprint = readdirSync(configDir);
        expect(footprint, `checkpointing footprint under ${configDir}`).not.toEqual([]);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    },
    10 * 60_000,
  );

  it(
    'reports whether the resume materialisation still copies credentials into temp',
    async () => {
      // Not a control question — a security one the offline suite turned up incidentally. When
      // `sessionStore` + `resume` are combined the SDK builds a temp CLAUDE_CONFIG_DIR and
      // copies `.credentials.json` (a live OAuth token) into it. Offline that dir survived the
      // failed spawn. This probe checks whether a SUCCESSFUL run cleans it up.
      const store = recordingStore();
      const before = readdirSync(tmpdir()).filter((name) => name.startsWith('claude-resume-'));
      await collect('Reply with the single word: ok', {
        ...BASE,
        resume: '99999999-9999-4999-8999-999999999999',
        sessionStore: store,
      }).catch(() => undefined);
      const after = readdirSync(tmpdir()).filter((name) => name.startsWith('claude-resume-'));
      const leaked = after.filter((name) => !before.includes(name));
      // HYPOTHESIS: the SDK cleans up on a clean exit and the offline leftovers were an artefact
      // of the stub failing. If leftovers appear here too, coa must clean them itself and the
      // finding is worth reporting upstream.
      expect(leaked, `credential-bearing temp dirs left behind: ${leaked.join(', ')}`).toEqual([]);
    },
    10 * 60_000,
  );
});
