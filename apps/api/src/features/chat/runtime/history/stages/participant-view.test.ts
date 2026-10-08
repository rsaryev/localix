import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../../../contracts'
import { projectParticipantView } from './participant-view'
import { participantAudienceFor } from './participant-audience'
import { toModelMessages } from '@localixai/agent/agents/chat'
import { findActiveInvocationIndex } from './media'
import type { SessionRecord } from '../../../repository'

const QA = 'agent:qa'
const DEV = 'agent:dev'

function row(
  id: string,
  from: string,
  role: 'user' | 'assistant',
  content: string,
  extra: Record<string, unknown> = {},
): PersistedMessage {
  return {
    id,
    sessionId: 's',
    userId: 'u',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    payload: { id, role, from, content, ...extra },
  } as PersistedMessage
}

describe('participant-view — the transcript as one participant reads it', () => {
  test('changing the shared topic does not make conversation-control calls visible to colleagues', () => {
    const changed = row('topic', DEV, 'assistant', 'Moving on to deployment.', {
      authorSnapshot: { handle: 'dev' },
      items: [
        {
          type: 'tool_call',
          id: 't-topic',
          name: 'conversation_control',
          status: 'completed',
          input: {
            next: [],
            topic: { title: 'Deploy', goal: 'Ship it.', previousTopicSummary: 'Tests passed.' },
          },
          resultText: 'Private tool acknowledgement',
        },
        { type: 'tool_call', id: 't-read', name: 'read', resultText: 'Private source contents' },
      ],
    })
    const other = projectParticipantView([changed], { viewer: QA })
    expect(other[0]!.payload.content).toBe('dev: Moving on to deployment.')
    expect(JSON.stringify(other)).not.toContain('previousTopicSummary')
    expect(JSON.stringify(other)).not.toContain('Private')
    const own = projectParticipantView([changed], { viewer: DEV })
    expect(own[0]!.payload.items).toHaveLength(2)
  })
  test('the viewer keeps its own rows as its own words, tool items included', () => {
    const [projected] = projectParticipantView(
      [
        row('a', QA, 'assistant', 'mine', {
          items: [{ type: 'tool_call', id: 't1', name: 'read' }],
        }),
      ],
      { viewer: QA },
    )
    expect(projected!.payload.role).toBe('assistant')
    expect(projected!.payload.content).toBe('mine')
    expect(projected!.payload.items).toHaveLength(1)
  })

  test('another member arrives as an incoming message, named', () => {
    const colleague = row('a', DEV, 'assistant', 'the build is green', {
      authorSnapshot: { handle: 'dev' },
    })
    const [projected] = projectParticipantView([colleague], { viewer: QA })
    // The role flip is the whole point: left as `assistant`, the model reads a colleague's
    // words as its own prior turn and continues them.
    expect(projected!.payload.role).toBe('user')
    expect(projected!.payload.content).toBe('dev: the build is green')
  })

  test("a colleague's tool activity is left out, because an action has an actor", () => {
    const colleague = row('a', DEV, 'assistant', 'fixed it', {
      authorSnapshot: { handle: 'dev' },
      items: [{ type: 'tool_call', id: 't1' }],
    })
    const [projected] = projectParticipantView([colleague], { viewer: QA })
    expect(projected!.payload.items).toBeUndefined()
  })

  test('private context attached to a colleague reply stays with its author', () => {
    const colleague = row('bound', DEV, 'assistant', 'public finding', {
      bindings: [{ kind: 'text', name: 'hook context', text: 'private hook evidence' }],
    })
    const own = projectParticipantView([colleague], { viewer: DEV })
    expect(own[0]!.payload.bindings).toHaveLength(1)
    const other = projectParticipantView([colleague], { viewer: QA })
    expect(other[0]!.payload.content).toBe('public finding')
    expect(JSON.stringify(other)).not.toContain('private hook evidence')
    expect(other[0]!.payload.bindings).toBeUndefined()
  })

  test('a colleague that said nothing out loud contributes nothing', () => {
    // A member that called `skip_answer`, or whose turn was pure tool work: there is no
    // utterance to attribute, and an empty attributed row would read as an empty remark.
    const silent = row('a', DEV, 'assistant', '', { authorSnapshot: { handle: 'dev' } })
    expect(projectParticipantView([silent], { viewer: QA })).toHaveLength(0)
  })

  test("a colleague's failed turn is not read as something it said", () => {
    // A provider error lands in `content` — right in a private chat, where the error IS the
    // reply. In a room the others would answer it as if a colleague had spoken.
    const failed = row('a', DEV, 'assistant', 'Error: Unknown pi model openrouter/nope', {
      authorSnapshot: { handle: 'dev' },
      failed: true,
    })
    expect(projectParticipantView([failed], { viewer: QA })).toHaveLength(0)
    // The member it happened to still sees its own turn — that is its own record of the failure.
    expect(projectParticipantView([failed], { viewer: DEV })).toHaveLength(1)
  })

  test("a member's own silent turn does not re-enter its own history", () => {
    // The hidden row a `skip_answer` leaves behind keeps the usage on the branch; it must not
    // become an empty assistant turn the member reads back as "I answered with nothing".
    const silent = row('a', QA, 'assistant', '', {
      isInternal: true,
      authorSnapshot: { handle: 'qa' },
    })
    expect(projectParticipantView([silent], { viewer: QA })).toHaveLength(0)
    expect(projectParticipantView([silent], { viewer: DEV })).toHaveLength(0)
  })

  test('silent private tool work survives for its author all the way to the model', () => {
    const silent = row('secret', QA, 'assistant', '', {
      isInternal: true,
      items: [
        {
          type: 'tool_call',
          id: 't1',
          toolCallId: 't1',
          name: 'read',
          status: 'completed',
          input: { path: 'notes/secret' },
          resultText: 'secret: violet',
        },
      ],
    })
    const own = projectParticipantView([silent], { viewer: QA, tools: new Set(['read']) })
    expect(JSON.stringify(toModelMessages(own.map((m) => m.payload)))).toContain('secret: violet')
    expect(projectParticipantView([silent], { viewer: DEV })).toEqual([])
    expect(silent.payload.isInternal).toBe(true)
  })

  test('membership changes never disable projection or transfer departed tool history', () => {
    const history = [
      row('a', DEV, 'assistant', 'done', {
        items: [{ type: 'tool_call', name: 'read', resultText: 'private secret' }],
      }),
    ]
    for (const agentIds of [['qa'], ['qa', 'dev'], ['qa'], ['dev', 'qa']]) {
      const session = { agents: agentIds.map((agentId) => ({ agentId })) } as SessionRecord
      const audience = participantAudienceFor(session, ['read'])
      const serialized = JSON.stringify(projectParticipantView(history, audience))
      expect(serialized.includes('private secret')).toBe(agentIds[0] === 'dev')
    }
  })

  test('projected agent speech is not a new instruction from the human', () => {
    const history = projectParticipantView(
      [
        row('u', 'user', 'user', 'begin'),
        ...['a', 'b', 'c'].map((id) => row(id, DEV, 'assistant', 'status')),
      ],
      { viewer: QA },
    )
    expect(findActiveInvocationIndex(history, undefined)).toBe(0)
  })

  test('unavailable tools retain historical observations without executable calls', () => {
    for (const type of ['tool_call', 'command', 'file_change', 'mcp_call'] as const) {
      const mine = row('a', QA, 'assistant', '', {
        isInternal: true,
        items: [{ type, id: 't1', name: 'retired', resultText: 'verified result' }],
      })
      const [projected] = projectParticipantView([mine], { viewer: QA, tools: new Set() })
      expect(projected!.payload.items).toMatchObject([
        {
          type: 'text',
          text: 'Historical observation from unavailable tool "retired":\nverified result',
        },
      ])
      expect(mine.payload.items![0]!.type).toBe(type)
    }
  })

  test('the user is the user to everyone', () => {
    const [projected] = projectParticipantView([row('a', 'user', 'user', 'ship it')], {
      viewer: QA,
    })
    expect(projected!.payload.role).toBe('user')
    expect(projected!.payload.content).toBe('ship it')
  })

  test('an unnamed colleague still speaks, just unattributed', () => {
    // authorSnapshot is captured at insert and is absent on rows written before it existed.
    // Dropping such a row would silently remove history; an unlabeled line is the lesser loss.
    const [projected] = projectParticipantView([row('a', DEV, 'assistant', 'hello')], {
      viewer: QA,
    })
    expect(projected!.payload.content).toBe('hello')
  })

  test('two members reading the same room get different transcripts', () => {
    const log = [
      row('u1', 'user', 'user', 'status?'),
      row('a1', QA, 'assistant', 'tests pass', { authorSnapshot: { handle: 'qa' } }),
      row('a2', DEV, 'assistant', 'deploying', { authorSnapshot: { handle: 'dev' } }),
    ]
    const asQa = projectParticipantView(log, { viewer: QA }).map((m) => m.payload.role)
    const asDev = projectParticipantView(log, { viewer: DEV }).map((m) => m.payload.role)
    expect(asQa).toEqual(['user', 'assistant', 'user'])
    expect(asDev).toEqual(['user', 'user', 'assistant'])
  })

  test('the projection is stable, so a member’s prompt prefix can be cached', () => {
    const log = [row('a1', DEV, 'assistant', 'hi', { authorSnapshot: { handle: 'dev' } })]
    expect(JSON.stringify(projectParticipantView(log, { viewer: QA }))).toBe(
      JSON.stringify(projectParticipantView(log, { viewer: QA })),
    )
  })

  test('a member never reads a call to a tool this run does not hold', () => {
    // A model reads its own history as proof of what it can do. Observed the other way round in
    // Two members with no preview tool reported that "the interactive browser is
    // blocked in this session", having inferred the capability from the room's talk about it.
    const mine = row('a', QA, 'assistant', 'checked', {
      items: [
        { type: 'tool_call', id: 't1', name: 'read' },
        { type: 'tool_call', id: 't2', name: 'browser' },
        { type: 'reasoning', id: 'r1' },
      ],
    })
    const [projected] = projectParticipantView([mine], { viewer: QA, tools: new Set(['read']) })
    expect(projected!.payload.items?.map((i) => (i as { id: string }).id)).toEqual(['t1', 'r1'])
  })

  test('no roster means no gating — every caller outside a room passes none', () => {
    const mine = row('a', QA, 'assistant', 'checked', {
      items: [{ type: 'tool_call', id: 't1', name: 'anything' }],
    })
    expect(projectParticipantView([mine], { viewer: QA })[0]!.payload.items).toHaveLength(1)
  })

  test('data routed to one member reaches the others as a single line', () => {
    // Nine board reports in one live room came to 13.9k characters, delivered whole to all four
    // members about cards belonging to one. The others still need to know the board answered —
    // a member that cannot see it will ask for the same work again — but not at full price.
    const long = 'x'.repeat(400)
    const routed = row('u2', 'system', 'user', long, {
      to: DEV,
      toSnapshot: { handle: 'dev' },
      isInternal: true,
      items: [{ type: 'reasoning', text: 'private reasoning' }],
      bindings: [{ kind: 'text', text: 'private attachment', name: 'secret' }],
    })
    const [forDev] = projectParticipantView([routed], { viewer: DEV })
    expect(forDev!.payload.content).toBe(long)
    const [forQa] = projectParticipantView([routed], { viewer: QA })
    expect(forQa!.payload.content).toBe('[Result delivered to "dev".]')
    expect(forQa!.payload.items).toBeUndefined()
    expect(forQa!.payload.bindings).toBeUndefined()
    expect(JSON.stringify(forQa)).not.toContain('private')
  })

  test('a member addressing another is still heard by the room', () => {
    // Conversation is broadcast; only routed DATA is narrowed. A room where "@dev, look at this"
    // were private would stop being one conversation.
    const said = row('a1', QA, 'assistant', 'dev, take a look', {
      to: DEV,
      toSnapshot: { handle: 'dev' },
      authorSnapshot: { handle: 'qa' },
    })
    const [forOther] = projectParticipantView([said], { viewer: DEV })
    expect(forOther!.payload.content).toBe('qa: dev, take a look')
  })
})
