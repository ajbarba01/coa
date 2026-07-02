import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { buildConversationHandlers } from './conversation-handlers.js';

describe('buildConversationHandlers', () => {
  let dir: string;
  let store: ConversationStore;
  let h: ReturnType<typeof buildConversationHandlers>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-ch-'));
    store = createConversationStore(dir);
    h = buildConversationHandlers(store);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a new session with a generated id and a default title', async () => {
    const { id } = (await h['newSession']!.handle({ agentRef: 'roles/reviewer', scope: 'src' })) as { id: string };
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(store.getMeta(id)).toMatchObject({ agentRef: 'roles/reviewer', title: 'new session', scope: 'src' });
  });

  it('lists sessions and reloads a conversation', async () => {
    const { id } = (await h['newSession']!.handle({ agentRef: 'r', scope: '' })) as { id: string };
    store.append(id, [{ seq: 0, frame: { t: 'text', text: 'hi' } }]);
    expect((await h['listSessions']!.handle(undefined) as unknown[]).length).toBe(1);
    expect(await h['reloadConversation']!.handle({ id })).toEqual([{ seq: 0, frame: { t: 'text', text: 'hi' } }]);
  });

  it('enriches a listed session with the running prompt config when one is frozen', async () => {
    const { id } = (await h['newSession']!.handle({ agentRef: 'r', scope: '' })) as { id: string };
    // No frozen prompt yet ⇒ no promptConfig (drift not yet detectable).
    expect(((await h['listSessions']!.handle(undefined)) as { promptConfig?: unknown }[])[0]).not.toHaveProperty(
      'promptConfig',
    );
    store.setCompilation(id, {
      neutral: { prefixHead: [], systemReminders: [], onDemandPullable: [], scopePushed: [], toolIntents: { allow: [], deny: [] } },
      frame: { allow: [], deny: [] },
      promptVersion: 'pv',
      configHash: 'cfg',
      config: { role: 'swe', packageIds: ['research'] },
    });
    const listed = (await h['listSessions']!.handle(undefined)) as { promptConfig?: unknown }[];
    expect(listed[0]?.promptConfig).toEqual({ role: 'swe', packageIds: ['research'] });
  });

  it('renames and deletes a session', async () => {
    const { id } = (await h['newSession']!.handle({ agentRef: 'r', scope: '' })) as { id: string };
    await h['renameSession']!.handle({ id, title: 'audit auth' });
    expect(store.getMeta(id)?.title).toBe('audit auth');
    await h['deleteSession']!.handle({ id });
    expect(store.getMeta(id)).toBeUndefined();
  });

  it('reloads an unknown id as an empty conversation', async () => {
    expect(await h['reloadConversation']!.handle({ id: 'nope' })).toEqual([]);
  });
});
