import { describe, expect, test } from 'bun:test'

import { resolveRunProfile, type AgentSessionKind } from '../../../agent-core/run-shape'
import { createRuntimeToolRegistry } from '../../../agent-core/tool-registry'
import { emptyLoadedMiniApps } from '../../../mini-apps/loader-contract'
import type { LoadedPlugins } from '../../../plugins/loader'
import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import { sessionFixture } from '../../../../testing/session-fixture'
import type { SessionRecord } from '../../repository'
import type { RunInvocation } from '../execution-context'
import { buildRunSystemPrompt } from './system-prompt-build'

/**
 * ONE system prompt. Whatever the run — the main agent, a subagent, a fork, a background
 * subagent, a child sub-session, a loop or automation run, a channel run, a workflow agent, a
 * hook run — the system prompt is the same bytes, built through the real assembly path
 * (`buildRunSystemPrompt`). What differs by run kind, tool set, depth or mode lives in the tools'
 * own descriptions and in the conversation's runtime context, as in Claude Code, so a run with
 * fewer tools reads the same cached prefix.
 *
 * The one allowed difference is the agent's own instructions (`profile.prompt.identity`), checked
 * separately below.
 */

const IDENTITY = 'You are the Localix agent.'

interface RunKind {
  name: string
  sessionKind: AgentSessionKind
  invocation: RunInvocation
  /** The tools an agent file lists (`tools:`), when the run kind narrows them. */
  tools?: string[]
  session?: Partial<SessionRecord>
  cwd?: string
  planMode?: { draftPath: string }
  unreachable?: boolean
}

const DELEGATION: RunInvocation = { kind: 'task-delegation' } as RunInvocation

const RUN_KINDS: RunKind[] = [
  { name: 'main agent', sessionKind: 'chat', invocation: { kind: 'root' } },
  {
    name: 'main agent in plan mode',
    sessionKind: 'chat',
    invocation: { kind: 'root' },
    planMode: { draftPath: '/repo/.localix/plans/s/PLAN.md' },
  },
  {
    name: 'main agent nobody can answer',
    sessionKind: 'chat',
    invocation: { kind: 'root' },
    unreachable: true,
  },
  {
    name: 'channel run',
    sessionKind: 'chat',
    invocation: { kind: 'channel' } as RunInvocation,
    session: { sourceToolCallId: 'channel:bridge:direct:chat-1' },
  },
  { name: 'subagent', sessionKind: 'subagent', invocation: DELEGATION },
  {
    name: 'background subagent',
    sessionKind: 'subagent',
    invocation: DELEGATION,
    tools: ['Read', 'Search', 'Bash'],
  },
  {
    name: 'fork with fewer tools',
    sessionKind: 'subagent',
    invocation: { kind: 'skill-fork' } as RunInvocation,
    tools: ['Read'],
  },
  {
    name: 'child sub-session in its own checkout',
    sessionKind: 'subagent',
    invocation: DELEGATION,
    cwd: '/tmp/checkouts/child',
    session: { parentSessionId: 'root' },
  },
  {
    name: 'workflow agent',
    sessionKind: 'subagent',
    invocation: DELEGATION,
    tools: ['Read', 'Write', 'Edit'],
    cwd: '/tmp/checkouts/wf',
  },
  {
    name: 'loop run',
    sessionKind: 'job',
    invocation: { kind: 'loop-subsession' } as RunInvocation,
  },
  { name: 'automation run', sessionKind: 'job', invocation: { kind: 'hook' } as RunInvocation },
  { name: 'system session', sessionKind: 'system', invocation: { kind: 'root' } },
]

async function systemPromptOf(run: RunKind, identity = IDENTITY): Promise<string> {
  const base = sessionFixture()
  const session = {
    ...base,
    sessionKind: run.sessionKind,
    ...run.session,
  } as SessionRecord
  const agentProfile = resolveRunProfile(
    { sessionKind: run.sessionKind },
    { prompt: identity, ...(run.tools ? { tools: run.tools } : {}) },
  )
  const built = await buildRunSystemPrompt({
    userId: session.userId,
    session,
    agentId: session.agent!.agentId,
    policy: runPolicyFixture(session, {
      invocation: run.invocation,
      hitl: { targetSessionId: session.id, reachable: !run.unreachable },
    }),
    providerId: 'test',
    agentProfile,
    runtimeTools: createRuntimeToolRegistry({ policy: { agentProfile } }),
    loadedPlugins: { loaded: [], agents: [], outputStyles: [] } as unknown as LoadedPlugins,
    loadedMiniApps: emptyLoadedMiniApps(),
    frozenContext: {},
    pinnedSkills: [],
    triggeredSkills: [],
    contextFiles: [],
    defaultCwd: run.cwd ?? '/repo',
    scratchDir: '/tmp/localix-test',
    childRuntimeSessions: new Map(),
    now: () => '2026-10-08',
    ...(run.planMode ? { planMode: run.planMode } : {}),
  })
  return built.systemPrompt
}

describe('one system prompt for every kind of run', () => {
  test('is byte-identical across run kinds', async () => {
    const [reference, ...rest] = await Promise.all(RUN_KINDS.map((run) => systemPromptOf(run)))
    RUN_KINDS.slice(1).forEach((run, index) => {
      expect({ run: run.name, prompt: rest[index] }).toEqual({ run: run.name, prompt: reference! })
    })
  })

  test('does not list the tools: their own definitions do', async () => {
    const prompt = await systemPromptOf(RUN_KINDS[0]!)
    expect(prompt).not.toContain('# Available tools')
  })

  test('only the agent’s own instructions may differ', async () => {
    const main = RUN_KINDS[0]!
    const a = await systemPromptOf(main, 'You are agent A.')
    const b = await systemPromptOf(main, 'You are agent B, with other duties.')
    expect(a.replace('You are agent A.', '')).toBe(
      b.replace('You are agent B, with other duties.', ''),
    )
    expect(await systemPromptOf(RUN_KINDS[4]!, 'You are agent A.')).toBe(a)
  })
})
