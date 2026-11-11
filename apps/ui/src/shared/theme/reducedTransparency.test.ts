import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { mirrorReducedTransparency } from './reducedTransparency'

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
