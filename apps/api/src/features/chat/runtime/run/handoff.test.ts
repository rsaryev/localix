import { describe, expect, test } from 'bun:test'

import { USER_PARTICIPANT } from '../../../../db/participant'
import type { StoredMessagePayload } from '../../../../db'
import type { AgentStreamEvent } from '../../contracts'
import { isHumanHandoff, publishHumanHandoff, withHandoff } from './handoff'

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
  test('a one-to-one chat stamps an explicit @human too: the chat waits on the person', () => {
    expect(isHumanHandoff(withHandoff(reply('@human, which do we pick?')))).toBe(true)
    expect(withHandoff(reply('Which do we pick?')).to).toBeUndefined()
  })

  test('@user is not the person: the row stays unstamped', () => {
    expect(isHumanHandoff(withHandoff(reply('@user, option A or B?')))).toBe(false)
  })

  test('a reply that asks the person in prose is stamped for them', () => {
    const stamped = withHandoff(reply('@human, option A or B?'))
    expect(stamped.to).toBe(USER_PARTICIPANT)
    expect(stamped.toSnapshot).toEqual({ handle: 'human' })
  })

  test('an ordinary reply is returned untouched, by identity', () => {
    // Identity, not equality: the finalizer writes whatever comes back, and a fresh object per
    // turn would defeat the `!==` comparisons the payload path uses to decide what changed.
    const payload = reply('Done, the tests are green.')
    expect(withHandoff(payload)).toBe(payload)
  })

  test('a mention of a COLLEAGUE is not a handback', () => {
    // Colleague scheduling is explicit through conversation_control; prose remains presentation text.
    const stamped = withHandoff(reply('@qa, run the suite?'))
    expect(stamped.to).toBeUndefined()
    expect(isHumanHandoff(stamped)).toBe(false)
  })

  test('a person mention is presentation metadata even when colleagues are also named', () => {
    const mixed = reply('The word is set, @human. Go ahead, @lead @qa — who is first?')
    expect(isHumanHandoff(withHandoff(mixed))).toBe(true)
  })

  test('a member naming ITSELF beside the person has still addressed nobody else', () => {
    expect(isHumanHandoff(withHandoff(reply('@lead is here; @human, A or B?')))).toBe(true)
  })
})

describe('publishHumanHandoff — telling the person', () => {
  const captured: AgentStreamEvent[] = []
  const io = {
    streamRegistry: {
      publish: (_u: string, _s: string, event: AgentStreamEvent) => captured.push(event),
    },
  }

  test('the frame names who asked and quotes what they asked', () => {
    publishHumanHandoff(io, {
      userId: 'u',
      sessionId: 's',
      payload: withHandoff(reply('@human, A or B?')),
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      type: 'user.mentioned',
      sessionId: 's',
      messageId: 'm1',
      from: 'lead',
      text: '@human, A or B?',
    })
  })

  test('long questions are trimmed — a banner is not a transcript', () => {
    captured.length = 0
    publishHumanHandoff(io, {
      userId: 'u',
      sessionId: 's',
      payload: reply(`@human ${'a very long question '.repeat(40)}`),
    })
    const event = captured[0] as Extract<AgentStreamEvent, { type: 'user.mentioned' }>
    expect(event.text.length).toBeLessThanOrEqual(281)
    expect(event.text.endsWith('…')).toBe(true)
  })

  test('external channels hear the same mention', () => {
    const heard: unknown[] = []
    publishHumanHandoff(
      { ...io, onHumanMentioned: (event) => heard.push(event) },
      { userId: 'u', sessionId: 's', payload: reply('@human, ship it?') },
    )
    expect(heard).toEqual([
      { sessionId: 's', messageId: 'm1', from: 'lead', text: '@human, ship it?' },
    ])
  })
})
