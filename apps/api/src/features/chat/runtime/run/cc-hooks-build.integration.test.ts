/**
 * What a run's start does for Claude Code hooks beyond SessionStart: the instruction files are
 * announced (InstructionsLoaded), the session's hooks are kept for its between-run events, a
 * SessionStart `watchPaths` seeds FileChanged, and a between-run hook's context reaches the turn.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createCcHookSessions } from '../cc-hook-sessions'
import { buildRunCcHooks, type BuildRunCcHooksInput } from './cc-hooks-build'

// The hooks here are real shell processes: on a loaded machine their spawns alone outlast bun's
// 5 s, so each wait is bounded by its own deadline below and every test by this one.
setDefaultTimeout(30_000)

const dir = tempDirPerTest('cc-build-')

function input(hooks: Record<string, unknown>, extra: Partial<BuildRunCcHooksInput> = {}) {
  const watched: string[][] = []
  const ccHookSessions = createCcHookSessions()
  const setWatchPaths = ccHookSessions.setWatchPaths
  ccHookSessions.setWatchPaths = (id, paths) => {
    watched.push([...paths])
    setWatchPaths(id, paths)
  }
  const state = {
    ccHooksStartedSessions: new Set<string>(),
    ccHooksSessionStartSource: new Map<string, string>(),
    ccHookOnceKeys: new Map<string, Set<string>>(),
    ccHookSessions,
  }
  const build: BuildRunCcHooksInput = {
    // Hook files go to this test's folder, never the developer's ~/.localix.
    env: {
      deps: { streamRegistry: { publish: () => {} }, sessionDataRoot: dir() },
      repo: { listMessages: async () => [] },
      state,
    } as never,
    userId: 'u1',
    session: { id: 's1', projectId: null, agent: null } as never,
    agentId: 'a1',
    params: { scope: {} } as never,
    catalog: {} as never,
    effectiveModelId: 'm',
    defaultCwd: dir(),
    disabledTools: [],
    availability: {} as never,
    capabilities: {} as never,
    loadedPlugins: {
      ccHooks: [{ pluginName: 'p', pluginRoot: dir(), dataDir: dir(), raw: { hooks } }],
    } as never,
    isContinuation: false,
    ...extra,
  }
  return { build, state, watched }
}
const capture = (name: string, then = 'exit 0') => [
  {
    hooks: [
      {
        type: 'command',
        // One append per hook: two hooks running at once must not interleave their lines.
        command: `line=$(cat); printf '%s\\n' "$line" >> "${join(dir(), name)}"; ${then}`,
      },
    ],
  },
]
const lines = (name: string) =>
  readFileSync(join(dir(), name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

describe('a run starting', () => {
  test('announces each instruction file with SessionStart, by scope, but not AGENTS.md', async () => {
    const { build } = input(
      { InstructionsLoaded: capture('il.jsonl') },
      {
        contextFiles: [
          { path: join(dir(), 'AGENTS.md') },
          { path: join(homedir(), '.localix', 'context.md') },
          { path: join(dir(), 'CLAUDE.md') },
        ],
      },
    )
    await buildRunCcHooks(build)
    for (const until = Date.now() + 20_000; Date.now() < until;) {
      try {
        if (lines('il.jsonl').length === 2) break
      } catch {}
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(
      lines('il.jsonl')
        .map((l) => `${l.memory_type} ${l.load_reason} ${l.file_path}`)
        .sort(),
    ).toEqual([
      `Project session_start ${join(dir(), 'CLAUDE.md')}`,
      `User session_start ${join(homedir(), '.localix', 'context.md')}`,
    ])
  })

  test("keeps the session's hooks for its between-run events and seeds the watch list", async () => {
    const out = JSON.stringify({ hookSpecificOutput: { watchPaths: [join(dir(), '.envrc')] } })
    const { build, state, watched } = input({
      SessionStart: [{ hooks: [{ type: 'command', command: `cat >/dev/null; echo '${out}'` }] }],
      CwdChanged: capture('cwd.jsonl'),
    })
    await buildRunCcHooks(build)
    expect(watched).toEqual([[join(dir(), '.envrc')]])
    expect(state.ccHookSessions.runtimeFor('s1').hasHooks('CwdChanged')).toBe(true)
  })

  test("a between-run hook's context reaches this turn, once", async () => {
    const { build, state } = input({ Stop: capture('stop.jsonl') })
    state.ccHookSessions.setPendingContext('s1', 'You are on opus now.')
    expect((await buildRunCcHooks(build)).ccSessionStartContext).toBe('You are on opus now.')
    expect((await buildRunCcHooks(build)).ccSessionStartContext).toBeUndefined()
  })
})

describe('a delegated agent’s frontmatter hooks', () => {
  const stop = { Stop: capture('agent-stop.jsonl'), PreToolUse: capture('agent-pre.jsonl') }
  const subagentRun = {
    session: {
      id: 's1',
      projectId: null,
      agent: null,
      provenance: {
        kind: 'task-delegation',
        parentSessionId: 'p',
        toolCallId: 't',
        agentType: 'guard',
      },
    } as never,
  }

  test('live for the run that has them, with Stop read as SubagentStop', async () => {
    const { build } = input(
      {},
      {
        ...subagentRun,
        agentHooks: [{ raw: stop, source: 'agent', asSubagent: true, agentType: 'guard' }],
      },
    )
    const { ccHooks } = await buildRunCcHooks(build)
    expect(ccHooks.hasHooks('PreToolUse')).toBe(true)
    expect(ccHooks.hasHooks('SubagentStop')).toBe(true)
    expect(ccHooks.hasHooks('Stop')).toBe(false)
  })

  test('gone with the run: the next run without them has none', async () => {
    const { build } = input({}, subagentRun)
    const { ccHooks } = await buildRunCcHooks(build)
    expect(ccHooks.hasHooks('PreToolUse')).toBe(false)
    expect(ccHooks.hasHooks('SubagentStop')).toBe(false)
  })
})
