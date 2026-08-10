import { describe, expect, it } from 'vitest';
import { SessionSummarySchema } from './agents.js';
import {
  LibraryViewResultSchema,
  ListSkillsResultSchema,
  UnlinkLibraryResultSchema,
} from './library.js';

describe('the library wire envelopes', () => {
  it('parses a listLibrary view (entries + discovered + diagnostics)', () => {
    const view = {
      entries: [
        {
          record: {
            name: 'commits',
            kind: 'skill',
            mode: 'copy',
            enabled: true,
            source: { path: '/s/SKILL.md' },
            provenance: { sourcePath: '/s/SKILL.md', contentHash: 'aa' },
          },
          scope: 'project',
          status: 'ok',
          skill: { name: 'commits', description: 'd', body: 'b' },
          drift: 'drifted',
        },
      ],
      discovered: {
        skills: [{ name: 'x', description: '', path: '/x/SKILL.md', origin: 'claude-user' }],
        mcpServers: [
          {
            name: 'search',
            configPath: '/p/.mcp.json',
            layer: 'project-mcp',
            config: { transport: 'stdio', command: 'npx' },
          },
        ],
      },
      diagnostics: [{ path: '/bad', problem: 'invalid', detail: 'nope' }],
    };
    expect(LibraryViewResultSchema.parse(view)).toEqual(view);
  });

  it('parses the listSkills and unlinkLibrary replies', () => {
    expect(
      ListSkillsResultSchema.parse({
        skills: [{ name: 'commits', description: 'd', scope: 'project' }],
      }).skills,
    ).toHaveLength(1);
    expect(UnlinkLibraryResultSchema.parse({ removed: false })).toEqual({ removed: false });
  });
});

describe('the session promptConfig skill slice', () => {
  it('keeps the frozen skill selection on a listed session (the drift key)', () => {
    const s = {
      id: 's1',
      agentRef: 'roles/writer',
      title: 't',
      updatedAt: 'now',
      promptConfig: { roles: ['swe'], skills: [{ name: 'commits', delivery: 'disclosure' }] },
    };
    expect(SessionSummarySchema.parse(s)).toEqual(s);
  });

  it('defaults a skill delivery to auto (the schema default, mirroring the daemon)', () => {
    const parsed = SessionSummarySchema.parse({
      id: 's1',
      agentRef: 'r',
      title: 't',
      updatedAt: 'now',
      promptConfig: { skills: [{ name: 'commits' }] },
    });
    expect(parsed.promptConfig?.skills).toEqual([{ name: 'commits', delivery: 'auto' }]);
  });
});
