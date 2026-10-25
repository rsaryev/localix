import { describe, expect, test } from 'bun:test'

import { ALL_MENTION_HANDLE, agentHandleSchema } from '@localixai/agent/agents'
import {
  mentionSpans,
  agentNameSpans,
  mentionedHandles,
  conversationMentionHandles,
} from './agent-mentions'

test('no agent may answer to a reserved address', () => {
  // An agent handled `all` would be unaddressable.
  for (const reserved of ['all', 'ALL']) {
    expect(agentHandleSchema.safeParse(reserved).success).toBe(false)
  }
  // Only `@all` is reserved: the person is no address, so `human` is an ordinary name.
  for (const handle of ['allison', 'user', 'human', 'human-agent'])
    expect(agentHandleSchema.safeParse(handle).success).toBe(true)
})

const PARTICIPANTS = ['lead', 'qa', 'backend']

describe('mentionedHandles — who a message addresses', () => {
  test('names the participants the text mentions, in order, once each', () => {
    expect(mentionedHandles('@qa take a look, then @lead. @qa again', PARTICIPANTS)).toEqual([
      'qa',
      'lead',
    ])
  })

  test('is case-insensitive and answers with the canonical handle', () => {
    // A handle is an identifier; people capitalise the start of a sentence.
    expect(mentionedHandles('@QA, did you click?', PARTICIPANTS)).toEqual(['qa'])
  })

  test('ignores an @ that is not a participant', () => {
    // "@2048" in a game's name, a stranger's handle — neither addresses anyone here.
    expect(
      mentionedHandles('let us build the @2048 game and call @designer', PARTICIPANTS),
    ).toEqual([])
  })

  test('does not read an e-mail address as a mention', () => {
    expect(mentionedHandles('write to qa@example.com', PARTICIPANTS)).toEqual([])
  })

  test('strips the punctuation a mention is followed by', () => {
    expect(mentionedHandles('hello, @backend: how is it going?', PARTICIPANTS)).toEqual(['backend'])
  })

  test('no participants or a text with no @ costs nothing and finds nothing', () => {
    expect(mentionedHandles('nobody', PARTICIPANTS)).toEqual([])
    expect(mentionedHandles('@qa', [])).toEqual([])
  })
})

describe('mentionSpans — where the mentions sit in the text', () => {
  test('covers @ plus the handle and nothing else', () => {
    const text = 'Hello @qa, and @Lead!'
    const spans = mentionSpans(text, PARTICIPANTS)
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['@qa', '@Lead'])
    expect(spans.map((s) => s.handle)).toEqual(['qa', 'lead'])
  })

  test('reports every occurrence, not just the first', () => {
    expect(mentionSpans('@qa @qa', PARTICIPANTS)).toHaveLength(2)
  })
})

describe('agentNameSpans — weak references in prose', () => {
  test('finds known handles without requiring @ and keeps canonical spelling', () => {
    const text = 'The winner is PM! Next in the queue is lead.'
    expect(agentNameSpans(text, ['pm', 'lead'])).toEqual([
      { start: text.indexOf('PM'), end: text.indexOf('PM') + 2, handle: 'pm' },
      { start: text.indexOf('lead'), end: text.indexOf('lead') + 4, handle: 'lead' },
    ])
  })

  test('does not reinterpret explicit mentions, substrings, emails, or reserved conversation words', () => {
    expect(agentNameSpans('@pm pmo qa@example.com all', ['pm', 'qa', 'all'])).toEqual([])
  })
})

describe('the person is not an address', () => {
  test('the conversation links its participants and everyone, never the person', () => {
    expect(conversationMentionHandles(PARTICIPANTS)).toEqual([...PARTICIPANTS, ALL_MENTION_HANDLE])
    // Agents reach the person through `ask`; an `@human` in a reply is plain text.
    expect(
      mentionedHandles('@all — @qa, ask @human', conversationMentionHandles(PARTICIPANTS)),
    ).toEqual([ALL_MENTION_HANDLE, 'qa'])
  })
})

describe('one reading for routing and for drawing', () => {
  test("a plugin agent's namespaced handle can be addressed", () => {
    // `AGENT_HANDLE_PATTERN` allows `plugin:agent`; the mention grammar used to stop at `:`.
    expect(mentionedHandles('ask @acme:k8s to check', ['acme:k8s', 'qa'])).toEqual(['acme:k8s'])
    // …while a colon after a plain handle is still punctuation.
    expect(mentionedHandles('@qa: please look', ['acme:k8s', 'qa'])).toEqual(['qa'])
  })

  test('a span is drawn for every mention that routes, known prefixes included', () => {
    // The span reader skipped the known-prefix rule, so this routed to @backend with no chip.
    expect(mentionSpans('@backendです', ['backend'])).toEqual([
      { start: 0, end: 8, handle: 'backend' },
    ])
    expect(mentionedHandles('@backendです', ['backend'])).toEqual(['backend'])
  })
})
