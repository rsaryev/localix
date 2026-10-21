import { expect, test } from 'bun:test'
import { registerSessionPreviews, sessionPreviews, type SessionPreviews } from './sessionPreviews'

const recorder = (calls: string[]): SessionPreviews => ({
  updated: (id) => calls.push(`updated:${id}`),
  command: (id) => calls.push(`command:${id}`),
  closed: (id) => calls.push(`closed:${id}`),
  forget: (ids) => calls.push(`forget:${ids.join(',')}`),
  open: (id, url) => calls.push(`open:${id}:${url}`),
})

test('a window with no previews installed ignores preview requests', () => {
  expect(() => sessionPreviews().forget(['s1'])).not.toThrow()
  expect(() => sessionPreviews().open('s1', 'http://localhost/')).not.toThrow()
})

test('the installed previews receive the requests until their owner removes them', () => {
  const first: string[] = []
  const second: string[] = []
  const removeFirst = registerSessionPreviews(recorder(first))
  const removeSecond = registerSessionPreviews(recorder(second))
  try {
    sessionPreviews().forget(['a', 'b'])
    // A stale owner cannot uninstall the previews that replaced it.
    removeFirst()
    sessionPreviews().open('a', 'http://localhost/')
    expect(first).toEqual([])
    expect(second).toEqual(['forget:a,b', 'open:a:http://localhost/'])
  } finally {
    removeSecond()
  }
  sessionPreviews().forget(['c'])
  expect(second).toHaveLength(2)
})
