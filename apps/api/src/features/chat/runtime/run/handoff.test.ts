import { describe, expect, test } from 'bun:test'

import { USER_PARTICIPANT } from '../../../../db/participant'
import type { StoredMessagePayload } from '../../../../db'
import type { AgentStreamEvent } from '../../contracts'
import { isUserHandoff, mentionsPerson, publishUserHandoff, withHandoff } from './handoff'

const ROOM = {
  agents: [
    { agentId: 'a', handle: 'lead' },
    { agentId: 'b', handle: 'qa' },
  ],
} as never
const PRIVATE = { agents: [{ agentId: 'a', handle: 'lead' }] } as never

const reply = (content: string, extra: Partial<StoredMessagePayload> = {}): StoredMessagePayload =>
  ({
    id: 'm1',
    role: 'assistant',
    from: 'agent:a',
    content,
    authorSnapshot: { handle: 'lead' },
    ...extra,
  }) as StoredMessagePayload

/** Public text only stamps presentation metadata for a question addressed to the person. */
describe('withHandoff — the text is what stamps the row', () => {
  test('a one-to-one chat stamps nothing: every reply is already for the person', () => {
    expect(isUserHandoff(withHandoff(PRIVATE, reply('@user, which do we pick?')))).toBe(false)
    expect(withHandoff(PRIVATE, reply('@user, which do we pick?')).to).toBeUndefined()
  })

  test('a reply that asks the person in prose is stamped for them', () => {
    const stamped = withHandoff(ROOM, reply('@user, option A or B?'))
    expect(stamped.to).toBe(USER_PARTICIPANT)
    expect(stamped.toSnapshot).toEqual({ handle: 'user' })
  })

  test('an ordinary reply is returned untouched, by identity', () => {
    // Identity, not equality: the finalizer writes whatever comes back, and a fresh object per
    // turn would defeat the `!==` comparisons the payload path uses to decide what changed.
    const payload = reply('Done, the tests are green.')
    expect(withHandoff(ROOM, payload)).toBe(payload)
  })

  test('a mention of a COLLEAGUE is not a handback', () => {
    // Colleague scheduling is explicit through conversation_control; prose remains presentation text.
    const stamped = withHandoff(ROOM, reply('@qa, run the suite?'))
    expect(stamped.to).toBeUndefined()
    expect(isUserHandoff(stamped)).toBe(false)
  })

  test('a person mention is presentation metadata even when colleagues are also named', () => {
    const party = {
      agents: [
        { agentId: 'a', handle: 'localix' },
        { agentId: 'b', handle: 'lead' },
        { agentId: 'c', handle: 'qa' },
      ],
    } as never
    const mixed = reply('The word is set, @user. Go ahead, @lead @qa — who is first?')
    expect(isUserHandoff(withHandoff(party, mixed))).toBe(true)
    expect(mentionsPerson(party, mixed)).toBe(true)
  })

  test('a member naming ITSELF beside the person has still addressed nobody else', () => {
    expect(isUserHandoff(withHandoff(ROOM, reply('@lead is here; @user, A or B?')))).toBe(true)
  })
})

describe('publishUserHandoff — telling the person', () => {
  const captured: AgentStreamEvent[] = []
  const io = {
    streamRegistry: {
      publish: (_u: string, _s: string, event: AgentStreamEvent) => captured.push(event),
    },
  }

  test('the frame names who asked and quotes what they asked', () => {
    publishUserHandoff(io, {
      userId: 'u',
      sessionId: 's',
      payload: withHandoff(ROOM, reply('@user, A or B?')),
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      type: 'user.mentioned',
      sessionId: 's',
      messageId: 'm1',
      from: 'lead',
      text: '@user, A or B?',
    })
  })

  test('long questions are trimmed — a banner is not a transcript', () => {
    captured.length = 0
    publishUserHandoff(io, {
      userId: 'u',
      sessionId: 's',
      payload: reply(`@user ${'a very long question '.repeat(40)}`),
    })
    const event = captured[0] as Extract<AgentStreamEvent, { type: 'user.mentioned' }>
    expect(event.text.length).toBeLessThanOrEqual(281)
    expect(event.text.endsWith('…')).toBe(true)
  })
})
