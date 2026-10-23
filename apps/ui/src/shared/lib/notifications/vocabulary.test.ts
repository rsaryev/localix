import { describe, expect, it } from 'bun:test'
import { personFacingLiterals, scanSources } from './personFacingLiterals.test-utils'

/**
 * The person's word for the thing they talk to the agent in is "conversation", pinned.
 *
 * The code says `session` and `chat` — the route, the store, the stream — and those words leaked
 * into the sentences a person reads: "Open a chat first", "Could not resync this session",
 * "Follow the session". Three names for one thing read as three things, and "session" is a word
 * people associate with logging in. The product's word is "conversation" (the sidebar, the
 * journal and the docs already use it), so every person-facing literal the wording guard reads
 * (`personFacingLiterals.test-utils.ts`) uses it too.
 *
 * The only exemption is CODE: a backticked span inside a sentence, and an identifier spelled like
 * one (`sessionId`, `chat.content`, `/rpc/sessions`, `session_id`). Never a whole file and never
 * a sentence — a sentence that needs the code word should quote it in backticks.
 */

const NOUN = /\b(chats?|sessions?)\b/i

/** Code inside a sentence: backticked spans, and dotted, slashed, snake- or camel-cased names. */
const CODE_IDENTIFIERS: readonly RegExp[] = [
  /`[^`]*`/g,
  /[\w-]*(?:[./:_]\w[\w-]*)+/g, // chat.content, /rpc/sessions, session_id, session:watch
  /\b[a-z]+(?:[A-Z]\w*)+\b/g, // sessionId, chatSurface
]

function withoutCode(text: string): string {
  return CODE_IDENTIFIERS.reduce((rest, pattern) => rest.replace(pattern, ' '), text)
}

/** Template interpolations are the caller's values, not words. */
const withoutInterpolations = (text: string) => text.replace(/\$\{[^}]*\}/g, ' ')

export function vocabularyViolations(source: string, path = '<fixture>', ui = true): string[] {
  const found: string[] = []
  for (const literal of personFacingLiterals(source, ui)) {
    const word = withoutCode(withoutInterpolations(literal.text)).match(NOUN)?.[1]
    if (word) found.push(`${path}:${literal.line} "${word}" for a conversation: ${literal.text}`)
  }
  return found
}

describe('the person’s vocabulary', () => {
  it('flags "chat" and "session" in every class of sentence (positive control)', () => {
    const fixture = [
      `toast.error('Could not delete this chat')`,
      `toast.error('Could not resync', { description: 'The session is out of date.' })`,
      `setError('Open a session first.')`,
      `toast.problems({ subject, problems: [{ message: 'The chats could not be read.' }] })`,
    ].join('\n')
    expect(vocabularyViolations(fixture).map((line) => line.split(' ').slice(1, 2)[0])).toEqual([
      '"chat"',
      '"session"',
      '"session"',
      '"chats"',
    ])
  })

  it('passes the person’s word and code quoted as code', () => {
    expect(
      vocabularyViolations(
        [
          `toast.error('Could not delete this conversation')`,
          'toast.error(`Could not read ${sessionId}`)',
          "setError('The `session.watch` request was refused.')",
          `setError('Could not reach /rpc/sessions.')`,
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('every person-facing literal in the host and in mini apps says "conversation"', () => {
    expect(scanSources(vocabularyViolations)).toEqual([])
  })
})
