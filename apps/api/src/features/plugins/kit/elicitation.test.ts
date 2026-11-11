import { describe, expect, test } from 'bun:test'

import { personElicitationAnswer } from './elicitation'

/**
 * The person's answer to a form as the server gets it, decided by the kit (`answerElicitation`; its
 * field rules and wording are tested in the kit): only the form's fields are sent, values that do
 * not fit are problems, a decline or a cancel carries nothing, and a link's acceptance has no content.
 */
const form = {
  server: 's',
  message: 'Which project?',
  mode: 'form' as const,
  requestedSchema: {
    type: 'object' as const,
    properties: { key: { type: 'string' as const, minLength: 2 } },
    required: ['key'],
  },
}

describe('the person’s answer to an elicitation', () => {
  test('a form sends its own fields only', () => {
    expect(
      personElicitationAnswer(form, { action: 'accept', content: { key: 'AB', x: 1 } }),
    ).toEqual({ result: { action: 'accept', content: { key: 'AB' } } })
  })

  test('values that do not fit are problems, named by the kit', () => {
    const answer = personElicitationAnswer(form, { action: 'accept', content: { key: 'A' } })
    expect('problems' in answer && answer.problems.length).toBe(1)
    expect(personElicitationAnswer(form, { action: 'accept' })).toHaveProperty('problems')
  })

  test('a decline carries nothing; a link is accepted without content', () => {
    expect(personElicitationAnswer(form, { action: 'decline', content: { key: 'AB' } })).toEqual({
      result: { action: 'decline' },
    })
    const url = { server: 's', message: 'Sign in', mode: 'url' as const, url: 'https://x.example' }
    expect(personElicitationAnswer(url, { action: 'accept' })).toEqual({
      result: { action: 'accept' },
    })
  })
})
