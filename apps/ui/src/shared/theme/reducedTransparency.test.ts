import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import {
  frameRootAttributes,
  hostReducesTransparency,
  mirrorReducedTransparency,
} from './reducedTransparency'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

function fakeQuery(matches: boolean) {
  let listener: ((event: { matches: boolean }) => void) | undefined
  return {
    matches,
    addEventListener: (_type: 'change', next: (event: { matches: boolean }) => void) => {
      listener = next
    },
    flip: (next: boolean) => listener?.({ matches: next }),
  }
}

describe('reduced transparency in a browser', () => {
  test('stamps the root while the engine reports the setting, and clears it when it goes', () => {
    const root = document.createElement('html')
    const query = fakeQuery(true)
    mirrorReducedTransparency(query, root)
    expect(root.dataset.reduceTransparency).toBe('true')
    query.flip(false)
    expect(root.dataset.reduceTransparency).toBeUndefined()
    query.flip(true)
    expect(root.dataset.reduceTransparency).toBe('true')
  })

  test('leaves the root alone when the setting is off', () => {
    const root = document.createElement('html')
    mirrorReducedTransparency(fakeQuery(false), root)
    expect('reduceTransparency' in root.dataset).toBe(false)
  })
})

/**
 * A frame the host builds (a mini app view, a mod's surface) is its own document: the stamp on the
 * host's root does not reach it, and its own `prefers-reduced-transparency` never matches in
 * WKWebView. So the host reads its stamp and writes it into the frame.
 */
describe('reduced transparency passed into a frame', () => {
  test('the host reads its own stamp', () => {
    delete document.documentElement.dataset.reduceTransparency
    expect(hostReducesTransparency()).toBe(false)
    document.documentElement.dataset.reduceTransparency = 'true'
    expect(hostReducesTransparency()).toBe(true)
    delete document.documentElement.dataset.reduceTransparency
  })

  test("the frame's root carries the theme, and the stamp only when the setting is on", () => {
    expect(frameRootAttributes('dark', false)).toBe('data-theme="dark"')
    expect(frameRootAttributes('light', true)).toBe(
      'data-theme="light" data-reduce-transparency="true"',
    )
  })
})
