import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'

import { createEffectiveConfigRoutes } from './routes'
import { promptTexts } from './prompt-texts'

/**
 * The reader that justifies the store. Without it, retaining prompt text would be storage
 * nothing consumes — and the snapshot's `previous.changed` already names the field that moved,
 * so the only thing missing was what moved inside it.
 */
function app() {
  // Typed like the real app: a bare `new Hono()` has no Variables, so `c.set('userId')` takes
  // `never` and the middleware this suite depends on cannot be written at all.
  const routes = new Hono<AppContext>()
  routes.use('*', async (c, next) => {
    c.set('userId', 'u1')
    await next()
  })
  routes.route('/cfg', createEffectiveConfigRoutes({} as never))
  return routes
}

const ask = async (from: string, to: string) => {
  const res = await app().request(
    `/cfg/prompt-diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  )
  return (await res.json()) as Record<string, unknown>
}

describe('what changed between two prompt-cache hashes', () => {
  test('answers with a diff of the retained texts', async () => {
    promptTexts.put('h-old', 'system prompt\nsession: 1\ntools: a,b')
    promptTexts.put('h-new', 'system prompt\nsession: 2\ntools: a,b')

    const body = await ask('h-old', 'h-new')

    expect(body.status).toBe('ready')
    // The point of the whole feature: naming the line that busted the prefix, not just the
    // field that changed.
    expect(String(body.diff)).toContain('-session: 1')
    expect(String(body.diff)).toContain('+session: 2')
    // Unchanged lines are context, not noise — a diff of two whole prompts is unreadable.
    expect(String(body.diff)).not.toContain('-tools: a,b')
  })

  test('a hash this process never saw is unavailable, not guessed at', async () => {
    const body = await ask('missing-1', 'missing-2')

    expect(body.status).toBe('unavailable')
    expect(body.missing).toEqual(['missing-1', 'missing-2'])
    // The reason has to name the gate, or the caller cannot tell "not retained" from "broken".
    expect(String(body.reason)).toContain('LOCALIX_CACHE_DIAGNOSTICS')
  })

  test('one side missing is still unavailable, and says which side', async () => {
    promptTexts.put('h-present', 'text')
    const body = await ask('h-present', 'h-absent')

    expect(body.status).toBe('unavailable')
    expect(body.missing).toEqual(['h-absent'])
  })

  test('equal text under two hashes is reported as identical, not as an empty diff', async () => {
    // An empty diff reads as "nothing changed", which would hide a hash function disagreeing
    // with itself.
    promptTexts.put('h-a', 'same text')
    promptTexts.put('h-b', 'same text')

    expect((await ask('h-a', 'h-b')).status).toBe('identical')
  })
})
