import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { SessionProvenance } from '../session-provenance'
import { channelNameFromSourceKey } from './axes/delivery'
import { conversationLeader, speakerPlace } from './axes/seat'
import { RUN_AXES, resolveRunPolicy, type RunPolicyFacts } from './run-policy'
import {
  conversationPolicy,
  hostPolicy,
  lineagePolicy,
  resolveSessionPolicy,
} from './session-policy'

const member = (handle: string) => ({ agentId: `agent-${handle}`, handle })

function session(over: Partial<RunPolicyFacts['session']> = {}): RunPolicyFacts['session'] {
  return {
    id: 's1',
    sessionKind: 'chat',
    parentSessionId: null,
    rootSessionId: null,
    provenance: { kind: 'root' },
    agents: [member('localix')],
    sourceToolCallId: null,
    ...over,
  }
}

function run(over: Partial<RunPolicyFacts> = {}): RunPolicyFacts {
  return {
    session: session(),
    speakerAgentId: 'agent-localix',
    invocation: { kind: 'root' },
    trigger: { continuation: false },
    hitl: { targetSessionId: 's1', reachable: true },
    priorities: new Map(),
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
  test('a lone chat agent may still bring colleagues in', () => {
    expect(conversationPolicy(session())).toEqual({
      kind: 'group',
      withColleagues: false,
      routing: 'direct',
      tagInvites: true,
      membershipEditable: true,
      showsDirectory: true,
      canPass: false,
      silentEmptyTurns: false,
      routesReplies: true,
      childReports: { allowUnaddressed: true },
    })
  })
  test('colleagues route by address, may pass and stay silent', () => {
    expect(conversationPolicy(session({ agents: [member('localix'), member('qa')] }))).toEqual({
      kind: 'group',
      withColleagues: true,
      routing: 'multi-participant',
      tagInvites: true,
      membershipEditable: true,
      showsDirectory: true,
      canPass: true,
      silentEmptyTurns: true,
      routesReplies: true,
      childReports: { allowUnaddressed: false },
    })
  })
  test('a non-chat session is isolated: fixed membership, no directory, no pass', () => {
    expect(conversationPolicy(session({ sessionKind: 'subagent' }))).toEqual({
      kind: 'isolated',
      withColleagues: false,
      routing: 'direct',
      tagInvites: false,
      membershipEditable: false,
      showsDirectory: false,
      canPass: false,
      silentEmptyTurns: false,
      routesReplies: false,
      childReports: null,
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

describe('seat', () => {
  const room = session({ agents: [member('localix'), member('qa')] })
  test('a lone agent leads and owns the topic', () => {
    expect(resolveRunPolicy(run()).seat).toEqual({
      role: 'solo',
      leader: member('localix'),
      ownsTopic: true,
    })
  })
  test('the highest definition priority leads; party order breaks a tie', () => {
    const priorities = new Map([['agent-qa', 5]])
    expect(resolveRunPolicy(run({ session: room, priorities })).seat).toEqual({
      role: 'member',
      leader: member('qa'),
      ownsTopic: false,
    })
    expect(
      resolveRunPolicy(run({ session: room, priorities, speakerAgentId: 'agent-qa' })).seat,
    ).toEqual({ role: 'leader', leader: member('qa'), ownsTopic: true })
    expect(conversationLeader(room, new Map())?.handle).toBe('localix')
  })
  test('a member learns the elected leader’s handle; the leader and a lone speaker do not', () => {
    const priorities = new Map([['agent-qa', 5]])
    const seatOf = (speakerAgentId: string, over: Partial<RunPolicyFacts> = {}) =>
      resolveRunPolicy(run({ session: room, priorities, speakerAgentId, ...over })).seat
    expect(speakerPlace(seatOf('agent-localix'))).toEqual({ role: 'member', leader: 'qa' })
    expect(speakerPlace(seatOf('agent-qa'))).toEqual({ role: 'leader' })
    expect(speakerPlace(resolveRunPolicy(run()).seat)).toEqual({ role: 'solo' })
  })
  test('nobody owns a topic outside a chat', () => {
    expect(resolveRunPolicy(run({ session: session({ sessionKind: 'job' }) })).seat).toMatchObject({
      role: 'solo',
      ownsTopic: false,
    })
  })
})

describe('trigger', () => {
  test.each([
    [{ continuation: true }, 'continuation'],
    [
      {
        continuation: false,
        turnTrigger: { kind: 'colleague-request', messageIds: ['m'], report: true },
      },
      'colleague-report',
    ],
    [
      { continuation: false, turnTrigger: { kind: 'colleague-request', messageIds: ['m'] } },
      'colleague-request',
    ],
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
      gateMayConfirm: true,
    })
  })
  test('an autonomous session is reachable but not expected to answer', () => {
    expect(
      resolveRunPolicy(run({ session: session({ permissionMode: 'autonomous' }) })).human,
    ).toEqual({
      targetSessionId: 's1',
      routeReachable: true,
      canAnswer: false,
      gateMayConfirm: false,
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
    ).toMatchObject({ canAnswer: false, gateMayConfirm: false })
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
      'seat',
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
