import { describe, expect, test } from 'bun:test'

import type { GrantOption } from '../../../agent-core/permission-grant-scope'
import { confirmTitle, MAX_REPLY_CHARS, readConfirmAnswer, wireGrants } from './confirm-answer'

const offered: GrantOption[] = [
  { scope: 'read(/w/a.ts)', kind: 'path', label: 'a.ts', covers: '/w/a.ts' },
  {
    scope: 'read(/w/*)',
    kind: 'folder',
    label: 'w',
    covers: 'anything inside /w',
    rule: { action: 'tool:read', resource: '/w/*' },
  },
]

describe('what an answer may mean', () => {
  test('a widening answer names one of the offered breadths', () => {
    const answer = readConfirmAnswer(
      { confirmed: true, scope: 'always', grant: 'read(/w/*)' },
      offered,
    )
    expect(answer.grant?.scope).toBe('read(/w/*)')
  })

  test('an id the card never offered widens nothing — the client cannot name its own folder', () => {
    const answer = readConfirmAnswer(
      { confirmed: true, scope: 'session', grant: 'read(/*)' },
      offered,
    )
    expect(answer).toEqual({ confirmed: true, scope: 'session' })
  })

  test('a client that names no grant gets the narrowest one', () => {
    expect(readConfirmAnswer({ confirmed: true, scope: 'session' }, offered).grant?.scope).toBe(
      'read(/w/a.ts)',
    )
  })

  test('once widens nothing, whatever it names', () => {
    expect(
      readConfirmAnswer({ confirmed: true, grant: 'read(/w/*)' }, offered).grant,
    ).toBeUndefined()
  })

  test('only a literal true approves', () => {
    // `Boolean("false")` is true — a string off the wire must not approve anything.
    expect(readConfirmAnswer({ confirmed: 'false' }, offered).confirmed).toBe(false)
    expect(readConfirmAnswer(undefined, offered).confirmed).toBe(false)
  })

  test('the reply is trimmed, bounded, and dropped when empty', () => {
    expect(readConfirmAnswer({ confirmed: false, message: '  use b.ts  ' }, []).message).toBe(
      'use b.ts',
    )
    expect(readConfirmAnswer({ confirmed: false, message: '   ' }, []).message).toBeUndefined()
    const long = readConfirmAnswer({ confirmed: false, message: 'x'.repeat(5000) }, [])
    expect(long.message).toHaveLength(MAX_REPLY_CHARS)
  })
})

test('the wire carries the rule in Settings spelling and the scope as an opaque id', () => {
  expect(wireGrants(offered)).toEqual([
    { id: 'read(/w/a.ts)', kind: 'path', label: 'a.ts', covers: '/w/a.ts' },
    {
      id: 'read(/w/*)',
      kind: 'folder',
      label: 'w',
      covers: 'anything inside /w',
      rule: 'read(/w/*)',
    },
  ])
})

describe('the title names the act and its object', () => {
  test.each([
    [{ toolName: 'bash', subject: 'command' as const }, 'Run a command'],
    [
      { toolName: 'read', subject: 'path' as const, targets: ['/w/src/useTheme.ts'] },
      'Read useTheme.ts',
    ],
    [{ toolName: 'apply_patch', subject: 'path' as const, targets: ['/a', '/b'] }, 'Edit 2 paths'],
    [
      { toolName: 'office', subject: 'path' as const, targets: ['/w/x.docx'] },
      'Use office on x.docx',
    ],
    [{ toolName: 'agents', subject: 'resource' as const }, 'Use agents'],
  ])('%o → %s', (input, title) => {
    expect(confirmTitle(input)).toBe(title)
  })
})
