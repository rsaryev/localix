import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
const realFetch = globalThis.fetch

beforeAll(() => {
  teardown = registerDom()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

afterAll(async () => {
  await teardown()
})

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect/></svg>'

describe('a standalone app’s icon', () => {
  test('is the mini app’s own icon, as the host serves it from its manifest', async () => {
    const asked: string[] = []
    globalThis.fetch = (async (input: string | URL) => {
      asked.push(input.toString())
      return new Response(SVG, { headers: { 'content-type': 'image/svg+xml' } })
    }) as unknown as typeof fetch
    const { loadAppIcon } = await import('./appIcon')
    const icon = await loadAppIcon('puzzle', 'Puzzle')
    expect(asked).toHaveLength(1)
    expect(new URL(asked[0]!).pathname).toBe('/rpc/mini-apps/puzzle/icon')
    expect(icon.type).toBe('image/svg+xml')
    expect(await icon.text()).toBe(SVG)
  })

  test('a mini app without one says what to add, rather than drawing a blank app', async () => {
    globalThis.fetch = (async () =>
      new Response('missing', { status: 404 })) as unknown as typeof fetch
    const { loadAppIcon } = await import('./appIcon')
    await expect(loadAppIcon('notes', 'Notes')).rejects.toThrow(
      'Notes has no icon of its own: add an "icon" to its mini-app.json',
    )
  })
})
