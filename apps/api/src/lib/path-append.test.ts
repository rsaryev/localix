import { describe, expect, test } from 'bun:test'
import { delimiter } from 'node:path'

import { appendToPath } from './path-append'

const join = (...parts: string[]) => parts.join(delimiter)

describe('appendToPath', () => {
  test('puts plugin dirs after the user PATH so they never shadow a user command', () => {
    const user = join('/usr/local/bin', '/usr/bin')
    expect(appendToPath(user, ['/plugins/a/bin', '/plugins/b/bin'])).toBe(
      join('/usr/local/bin', '/usr/bin', '/plugins/a/bin', '/plugins/b/bin'),
    )
  })

  test('leaves PATH untouched for no dirs', () => {
    expect(appendToPath('/usr/bin', [])).toBe('/usr/bin')
    expect(appendToPath('/usr/bin', undefined)).toBe('/usr/bin')
    expect(appendToPath(undefined, undefined)).toBeUndefined()
  })

  test('works from an empty PATH and skips duplicates and empty entries', () => {
    expect(appendToPath(undefined, ['/plugins/a/bin'])).toBe('/plugins/a/bin')
    expect(appendToPath(join('/usr/bin', '/plugins/a/bin'), ['/plugins/a/bin', '', '/p/b'])).toBe(
      join('/usr/bin', '/plugins/a/bin', '/p/b'),
    )
  })
})
