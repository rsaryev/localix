import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { SessionProvenance } from '../session-provenance'
import { channelNameFromSourceKey } from './axes/delivery'
import { RUN_AXES, resolveRunPolicy, type RunPolicyFacts } from './run-policy'
import {
  conversationPolicy,
  hostPolicy,
  lineagePolicy,
  resolveSessionPolicy,
} from './session-policy'

function session(over: Partial<RunPolicyFacts['session']> = {}): RunPolicyFacts['session'] {
  return {
    id: 's1',
    sessionKind: 'chat',
    parentSessionId: null,
    rootSessionId: null,
    provenance: { kind: 'root' },
    sourceToolCallId: null,
    ...over,
  }
}

function run(over: Partial<RunPolicyFacts> = {}): RunPolicyFacts {
  return {
    session: session(),
    invocation: { kind: 'root' },
    trigger: { continuation: false },
    hitl: { targetSessionId: 's1', reachable: true },
    ...over,
  }
}

describe('host', () => {
  test.each([
    ['chat', false, false, true, true, true, false, false],
    ['subagent', true, true, false, true, true, true, true],
    ['job', true, true, false, true, false, true, false],
    ['system', true, true, false, false, true, false, false],
  ] as const)(
    '%s',
    (kind, remembers, status, freezes, steers, jobs, mirrors, presentsAsSubagent) => {
      expect(hostPolicy({ sessionKind: kind })).toEqual({
        kind,
        remembersRunIdentity: remembers,
        persistsRuntimeStatus: status,
        freezesPromptContext: freezes,
        steers,
        supervisesJobs: jobs,
        mirrorsActivityToParent: mirrors,
        presentsAsSubagent,
      })
    },
  )
})

describe('lineage', () => {
  const delegated: SessionProvenance = {
    kind: 'task-delegation',
    parentSessionId: 'root',
    toolCallId: 'call-1',
  }
  test('only the original conversation delegates and authors agents', () => {
    expect(lineagePolicy(session())).toEqual({
      rootId: 's1',
      depth: 0,
      mayDelegate: true,
      managesAgents: true,
      ownsPlan: true,
      reportsToDelegator: false,
    })
  })
  test('a thread is its own chat but creates no delegated work', () => {
    const thread = lineagePolicy(
      session({
        parentSessionId: 'root',
        rootSessionId: 'root',
        provenance: { kind: 'thread', parentSessionId: 'root', phase: 'message' },
      }),
    )
    expect(thread).toMatchObject({ rootId: 'root', mayDelegate: false, managesAgents: false })
    expect(thread.ownsPlan).toBe(false)
  })
  test('a delegated child reports to its delegator and cannot delegate again', () => {
    expect(
      lineagePolicy(
        session({
          sessionKind: 'subagent',
          parentSessionId: 'root',
          rootSessionId: 'root',
          provenance: delegated,
        }),
      ),
    ).toEqual({
      rootId: 'root',
      depth: 1,
      mayDelegate: false,
      managesAgents: false,
      ownsPlan: false,
      reportsToDelegator: true,
    })
  })
  test('a root-provenance chat with a parent authors agents but may not delegate', () => {
    // The weaker `agents` predicate is kept exactly as `agents-options.ts` stated it.
    expect(lineagePolicy(session({ parentSessionId: 'p' }))).toMatchObject({
      mayDelegate: false,
      managesAgents: true,
    })
  })
})

describe('conversation', () => {
  test('a chat takes a delegated child’s report into a running turn', () => {
    expect(conversationPolicy(session())).toEqual({
      kind: 'chat',
      childReports: true,
    })
  })
  test('a non-chat session is isolated and takes no reports', () => {
    expect(conversationPolicy(session({ sessionKind: 'subagent' }))).toEqual({
      kind: 'isolated',
      childReports: false,
    })
  })
})

describe('delivery and permission', () => {
  test('a channel key names the channel the reply is relayed through', () => {
    expect(
      resolveSessionPolicy(session({ sourceToolCallId: 'channel:bridge:direct:c-1' })).delivery,
    ).toEqual({ channel: 'direct' })
    expect(resolveSessionPolicy(session()).delivery).toEqual({})
    expect(channelNameFromSourceKey('channel:discord:thread:guild:room:message')).toBe('thread')
    expect(channelNameFromSourceKey('channel:sample-bridge')).toBeUndefined()
  })
  test.each([
    [undefined, 'default', false, true],
    ['plan', 'plan', true, true],
    ['bypass', 'bypass', false, true],
    ['autonomous', 'autonomous', false, false],
  ] as const)('mode %s', (stored, mode, planning, humanExpected) => {
    expect(resolveSessionPolicy(session({ permissionMode: stored })).permission).toEqual({
      mode,
      planning,
      humanExpected,
    })
  })
})

describe('permission of a delegated child whose agent file names a mode', () => {
  const child = (permissionMode: 'default' | 'plan' | 'bypass' | 'autonomous', asked?: 'plan') =>
    resolveSessionPolicy(
      session({
        sessionKind: 'subagent',
        parentSessionId: 'p',
        permissionMode,
        provenance: {
          kind: 'task-delegation',
          parentSessionId: 'p',
          toolCallId: 't',
          ...(asked ? { agentPermissionMode: asked } : {}),
        },
      }),
    ).permission

  test('a Default conversation lets the agent plan; every other mode is kept', () => {
    expect(child('default', 'plan')).toMatchObject({ mode: 'plan', planning: true })
    expect(child('default')).toMatchObject({ mode: 'default', planning: false })
    expect(child('bypass', 'plan')).toMatchObject({ mode: 'bypass', planning: false })
    expect(child('autonomous', 'plan')).toMatchObject({ mode: 'autonomous', humanExpected: false })
  })

  test('the conversation changing mode rewrites the child row, and the agent still holds', () => {
    expect(child('plan', 'plan').mode).toBe('plan')
  })
})

describe('invocation', () => {
  test.each([
    [{ kind: 'root' }, 'chat'],
    [{ kind: 'channel' }, 'channel'],
    [{ kind: 'task-delegation', parentSessionId: 'p' }, 'delegation'],
    [{ kind: 'skill-fork', parentSessionId: 'p' }, 'delegation'],
    [{ kind: 'loop-subsession', parentSessionId: 'p', loopId: 'l' }, 'automation'],
    [{ kind: 'hook', parentSessionId: 'p' }, 'verification'],
    [{ kind: 'isolated-continuation', sessionId: 's1' }, 'unknown'],
  ] as const)('%o is admitted as %s', (invocation, admissionHost) => {
    expect(resolveRunPolicy(run({ invocation })).invocation).toEqual({
      kind: invocation.kind,
      admissionHost,
    })
  })
})

describe('trigger', () => {
  test.each([
    [{ continuation: true }, 'continuation'],
    [{ continuation: false, promptOrigin: 'reaction' }, 'reaction'],
    [{ continuation: false }, 'message'],
  ] as const)('%o is a %s turn', (trigger, kind) => {
    expect(resolveRunPolicy(run({ trigger })).trigger.kind).toBe(kind)
  })
  test('a reaction allows silence even inside a continuation', () => {
    expect(
      resolveRunPolicy(run({ trigger: { continuation: true, promptOrigin: 'reaction' } })).trigger,
    ).toEqual({ kind: 'continuation', answersReaction: true })
  })
})

describe('human', () => {
  test('a reachable chat in an attended mode can answer and confirm', () => {
    expect(resolveRunPolicy(run()).human).toEqual({
      targetSessionId: 's1',
      routeReachable: true,
      canAnswer: true,
      withheldTools: {},
    })
  })
  test('an autonomous session is reachable but not expected to answer', () => {
    expect(
      resolveRunPolicy(run({ session: session({ permissionMode: 'autonomous' }) })).human,
    ).toEqual({
      targetSessionId: 's1',
      routeReachable: true,
      canAnswer: false,
      // Every call would be refused, and holding the tools told the model to use them.
      withheldTools: { AskUserQuestion: 'human.answer', Configure: 'human.answer' },
    })
  })
  test('a parentless job has no chat to show a card in', () => {
    expect(
      resolveRunPolicy(
        run({
          session: session({ sessionKind: 'job' }),
          hitl: { targetSessionId: null, reachable: false },
        }),
      ).human,
    ).toMatchObject({ canAnswer: false })
  })
  test('a chat whose ancestry cannot be verified never shows a card, so nobody "declines" it', () => {
    expect(
      resolveRunPolicy(run({ hitl: { targetSessionId: null, reachable: false } })).human.canAnswer,
    ).toBe(false)
  })
})

describe('the axis set', () => {
  test('a run resolves every axis, session axes first, and traces each one', () => {
    expect(resolveRunPolicy(run()).trace.map((entry) => entry.axis)).toEqual([...RUN_AXES])
    expect([...RUN_AXES]).toEqual([
      'host',
      'lineage',
      'conversation',
      'delivery',
      'permission',
      'invocation',
      'trigger',
      'human',
    ])
  })
  test('every axis has its own module and every module is an axis', () => {
    const files = readdirSync(join(import.meta.dir, 'axes'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => name.slice(0, -'.ts'.length))
    expect(files.sort()).toEqual([...RUN_AXES].sort())
  })
})
