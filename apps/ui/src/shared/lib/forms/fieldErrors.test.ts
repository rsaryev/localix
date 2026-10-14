import { describe, expect, test } from 'bun:test'
import { focusFirstInvalid, hasFieldErrors, type FieldErrors } from './fieldErrors'

type Field = 'name' | 'prompt' | 'limit'

/** A DOM stub: `focusFirstInvalid` needs `getElementById` and `focus`, nothing else. */
function docWith(ids: readonly string[]) {
  const focused: string[] = []
  const elements = new Map(
    ids.map((id) => [id, { focus: () => focused.push(id) } as unknown as HTMLElement]),
  )
  return { focused, doc: { getElementById: (id: string) => elements.get(id) ?? null } }
}

const IDS = { name: 'f-name', prompt: 'f-prompt', limit: 'f-limit' }

describe('hasFieldErrors', () => {
  test('an object of cleared fields is not an error', () => {
    // `clear` writes `undefined` rather than deleting, so the keys outlive the messages.
    expect(hasFieldErrors({})).toBe(false)
    expect(hasFieldErrors({ name: undefined } as FieldErrors<Field>)).toBe(false)
    expect(hasFieldErrors({ name: 'Required.' })).toBe(true)
  })
})

describe('focusFirstInvalid', () => {
  /**
   * The one thing the old pinned summary did better than nothing: it was near the button,
   * so the reader saw it. Per-field messages are better placed and easier to miss — the
   * field may be scrolled out of view — so the submit takes the reader to the first one.
   */
  test('focuses the first failing field in the order the validator reported', () => {
    const { focused, doc } = docWith(Object.values(IDS))
    const errors: FieldErrors<Field> = { name: 'Required.', limit: 'Above zero.' }
    expect(focusFirstInvalid(errors, IDS, doc)).toBe(true)
    expect(focused).toEqual(['f-name'])
  })

  test('order comes from the errors, not from the id map', () => {
    const { focused, doc } = docWith(Object.values(IDS))
    focusFirstInvalid({ limit: 'Above zero.', name: 'Required.' }, IDS, doc)
    expect(focused).toEqual(['f-limit'])
  })

  test('a cleared field is skipped, not focused', () => {
    const { focused, doc } = docWith(Object.values(IDS))
    focusFirstInvalid({ name: undefined, prompt: 'Required.' } as FieldErrors<Field>, IDS, doc)
    expect(focused).toEqual(['f-prompt'])
  })

  test('a field whose control is not on screen falls through to the next', () => {
    // A transport toggle hides the URL field; its error must not swallow the focus.
    const { focused, doc } = docWith(['f-prompt'])
    expect(focusFirstInvalid({ name: 'Required.', prompt: 'Required.' }, IDS, doc)).toBe(true)
    expect(focused).toEqual(['f-prompt'])
  })

  test('nothing focusable is not an exception', () => {
    const { doc } = docWith([])
    expect(focusFirstInvalid({ name: 'Required.' }, IDS, doc)).toBe(false)
  })
})
