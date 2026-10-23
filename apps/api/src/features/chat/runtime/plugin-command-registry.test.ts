import { describe, expect, test } from 'bun:test'

import { createMiniAppCommandRegistry } from './plugin-command-registry'

interface Published {
  userId: string
  sessionId: string
  event: { type: string; commandId?: string; plugin?: string; channel?: string; seq?: number }
}

function fakeRegistry(publishError?: Error) {
  const published: Published[] = []
  const streamRegistry = {
    publish: (userId: string, sessionId: string, event: Published['event']) => {
      published.push({ userId, sessionId, event })
      if (publishError) throw publishError
    },
  } as unknown as Parameters<typeof createMiniAppCommandRegistry>[0]['streamRegistry']
  return { published, streamRegistry }
}

const sendInput = {
  userId: 'u1',
  sessionId: 's1',
  plugin: 'sample-plugin',
  channel: 'chart',
  payload: { action: 'snapshot', connectionId: 'c1', symbol: 'BTC/USDC:USDC' },
  seq: 1,
}

describe('plugin-command-registry', () => {
  test('send publishes a plugin.command frame and resolve settles the promise', () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createMiniAppCommandRegistry({ streamRegistry })

    const pending = reg.send(sendInput)
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      userId: 'u1',
      sessionId: 's1',
      event: { type: 'plugin.command', plugin: 'sample-plugin', channel: 'chart', seq: 1 },
    })
    const commandId = published[0]!.event.commandId!
    expect(commandId).toStartWith('plc_')

    const settled = reg.resolve(commandId, { ok: true, result: { mounted: true } }, 'u1')
    expect(settled).toBe(true)
    expect(pending).resolves.toEqual({ ok: true, result: { mounted: true } })
  })

  test('resolve is ownership-gated — a different user cannot settle it', () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createMiniAppCommandRegistry({ streamRegistry, timeoutMs: 50 })

    const pending = reg.send(sendInput)
    const commandId = published[0]!.event.commandId!

    expect(reg.resolve(commandId, { ok: true, result: {} }, 'intruder')).toBe(false)
    // The real owner still can — including reporting a failure.
    expect(reg.resolve(commandId, { ok: false, error: 'nope' }, 'u1')).toBe(true)
    expect(pending).resolves.toEqual({ ok: false, error: 'nope' })
  })

  test('resolve returns false for an unknown commandId', () => {
    const { streamRegistry } = fakeRegistry()
    const reg = createMiniAppCommandRegistry({ streamRegistry })
    expect(reg.resolve('plc_missing', { ok: true, result: {} }, 'u1')).toBe(false)
  })

  test('publish failure returns a tool-readable failure and releases the correlation id', async () => {
    const { published, streamRegistry } = fakeRegistry(new Error('serialize failed'))
    const reg = createMiniAppCommandRegistry({ streamRegistry, timeoutMs: 5_000 })

    const outcome = await reg.send(sendInput)
    expect(outcome).toEqual({
      ok: false,
      error: 'Failed to send the plugin command to the UI: serialize failed',
    })
    const commandId = published[0]!.event.commandId!
    expect(reg.resolve(commandId, { ok: true, result: 'late' }, 'u1')).toBe(false)
  })

  test('times out to noReply when no client answers', async () => {
    const { streamRegistry } = fakeRegistry()
    const reg = createMiniAppCommandRegistry({ streamRegistry, timeoutMs: 20 })
    const outcome = await reg.send(sendInput)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.noReply).toBe(true)
      expect(outcome.error).toContain('No reply from the UI')
    }
    // A reply arriving AFTER the timeout is an unknown id, not a crash.
    expect(reg.resolve('plc_whatever', { ok: true }, 'u1')).toBe(false)
  })

  test('per-call timeout override wins over the registry default', async () => {
    const { streamRegistry } = fakeRegistry()
    const reg = createMiniAppCommandRegistry({ streamRegistry, timeoutMs: 5_000 })
    const start = Date.now()
    const outcome = await reg.send({ ...sendInput, timeoutMs: 15 })
    expect(Date.now() - start).toBeLessThan(1_000)
    expect(outcome).toMatchObject({ ok: false, noReply: true })
  })

  test("closeForSession rejects only that session's pending commands", async () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createMiniAppCommandRegistry({ streamRegistry, timeoutMs: 5_000 })
    const a = reg.send(sendInput)
    const b = reg.send({ ...sendInput, sessionId: 's2', seq: 2 })

    reg.closeForSession('u1', 's1')
    expect(await a).toMatchObject({ ok: false, noReply: true })

    // s2 is untouched — still resolvable by its owner.
    const otherId = published[1]!.event.commandId!
    expect(reg.resolve(otherId, { ok: true, result: 42 }, 'u1')).toBe(true)
    expect(await b).toEqual({ ok: true, result: 42 })
  })
})
