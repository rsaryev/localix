import { expect, it } from 'bun:test'
import { parseSurfaceLines } from './parse'

it('decodes exact JSON insertion strings for each surface', () => {
  expect(
    parseSurfaceLines('chat: "pletion"\ngit.commit: " tests"', ['chat', 'git.commit']),
  ).toEqual({ chat: 'pletion', 'git.commit': ' tests' })
  expect(parseSurfaceLines('chat: "\\nsecond line"', ['chat'])).toEqual({ chat: '\nsecond line' })
  expect(parseSurfaceLines('chat: "broken', ['chat'])).toEqual({ chat: '' })
  expect(parseSurfaceLines('" suffix"', ['chat'])).toEqual({ chat: ' suffix' })
})
