import { describe, expect, test } from 'bun:test'

import { createPreviewCommandRegistry } from './preview-command-registry'
import type { PreviewCommandResult } from '../../agent-core/tools/preview/preview-control'

interface Published {
  userId: string
  sessionId: string
  event: { type: string; commandId?: string }
}

function fakeRegistry(publishError?: Error) {
  const published: Published[] = []
  const streamRegistry = {
    publish: (userId: string, sessionId: string, event: { type: string; commandId?: string }) => {
      published.push({ userId, sessionId, event })
      if (publishError) throw publishError
    },
    hasConnectedClient: () => true,
  } as unknown as Parameters<typeof createPreviewCommandRegistry>[0]['streamRegistry']
  return { published, streamRegistry }
}

const snapResult: PreviewCommandResult = {
  action: 'snapshot',
  snapshot: {
    tree: '- button "Go" [ref=e1]',
    stats: { nodes: 1, interactive: 1, chars: 10 },
    url: 'http://x',
    title: 'X',
  },
}

describe('preview-command-registry', () => {
  test('two hosts cannot execute one command or settle another host claim', async () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })
    const pending = reg.send({
      userId: 'owner',
      sessionId: 'child',
      command: { action: 'viewport', previewId: 'origin', viewport: { width: 375, height: 667 } },
    })
    const id = published[0]!.event.commandId!
    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'wrong' }, 'intruder')).toBe(false)
    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'one' }, 'owner')).toBe(true)
    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'two' }, 'owner')).toBe(false)
    expect(reg.resolve(id, { ok: true, result: snapResult, hostId: 'two' }, 'owner')).toBe(false)
    expect(reg.resolve(id, { ok: true, result: snapResult, hostId: 'one' }, 'owner')).toBe(true)
    expect(await pending).toMatchObject({ ok: true })
    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'later' }, 'owner')).toBe(false)
  })

  test('an unexecuted host can release its claim to the replacement host', async () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })
    const pending = reg.send({
      userId: 'owner',
      sessionId: 'child',
      command: { action: 'snapshot', previewId: 'origin' },
    })
    const id = published[0]!.event.commandId!

    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'hidden' }, 'owner')).toBe(true)
    expect(reg.resolve(id, { ok: false, release: true, hostId: 'other' }, 'owner')).toBe(false)
    expect(reg.resolve(id, { ok: false, release: true, hostId: 'hidden' }, 'owner')).toBe(true)
    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'visible' }, 'owner')).toBe(true)
    expect(reg.resolve(id, { ok: true, result: snapResult, hostId: 'visible' }, 'owner')).toBe(true)
    expect(await pending).toMatchObject({ ok: true })
  })

  // The visible tab mounts and claims while the hidden host still holds the
  // claim, so its claim is refused and dropped; the hidden host then unmounts and releases.
  // Without a re-publish nobody holds the command and it times out as host_unavailable.
  test('a release hands the command back to every host, including one refused earlier', async () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })
    const pending = reg.send({
      userId: 'owner',
      sessionId: 'chat',
      command: { action: 'snapshot', previewId: 'origin' },
    })
    const id = published[0]!.event.commandId!

    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'hidden' }, 'owner')).toBe(true)
    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'visible' }, 'owner')).toBe(false)
    expect(reg.resolve(id, { ok: false, release: true, hostId: 'hidden' }, 'owner')).toBe(true)

    expect(published).toHaveLength(2)
    expect(published[1]).toEqual(published[0]!)
    expect(reg.resolve(id, { ok: false, claim: true, hostId: 'visible' }, 'owner')).toBe(true)
    expect(reg.resolve(id, { ok: true, result: snapResult, hostId: 'visible' }, 'owner')).toBe(true)
    expect(await pending).toMatchObject({ ok: true })
  })

  test('commands sharing an origin serialize across sessions', async () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })
    const a = reg.send({
      userId: 'u',
      sessionId: 'a',
      command: { action: 'snapshot', previewId: 'origin' },
    })
    const b = reg.send({
      userId: 'u',
      sessionId: 'b',
      command: { action: 'snapshot', previewId: 'origin' },
    })
    expect(published).toHaveLength(1)
    reg.resolve(published[0]!.event.commandId!, { ok: true, result: snapResult }, 'u')
    await a
    await Promise.resolve()
    expect(published).toHaveLength(2)
    reg.resolve(published[1]!.event.commandId!, { ok: true, result: snapResult }, 'u')
    expect(await b).toMatchObject({ ok: true })
  })

  test('closing a session cancels its queued command without affecting another origin owner', async () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })
    const first = reg.send({
      userId: 'u',
      sessionId: 'first',
      command: { action: 'snapshot', previewId: 'origin' },
    })
    const queued = reg.send({
      userId: 'u',
      sessionId: 'closed',
      command: { action: 'click', previewId: 'origin', ref: 'e1' },
    })
    reg.closeForSession('u', 'closed')
    reg.resolve(published[0]!.event.commandId!, { ok: true, result: snapResult }, 'u')
    expect(await first).toMatchObject({ ok: true })
    expect(await queued).toMatchObject({ ok: false, errorCode: 'host_unavailable' })
    expect(published).toHaveLength(1)
  })

  test('an absent app is diagnosed without publishing or waiting for a timeout', async () => {
    const { published, streamRegistry } = fakeRegistry()
    streamRegistry.hasConnectedClient = () => false
    const reg = createPreviewCommandRegistry({ streamRegistry })
    expect(
      await reg.send({ userId: 'u', sessionId: 's', command: { action: 'snapshot' } }),
    ).toMatchObject({ ok: false, errorCode: 'app_disconnected' })
    expect(published).toHaveLength(0)
  })
  test('send publishes a preview.command and resolve settles the promise', () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })

    const pending = reg.send({ userId: 'u1', sessionId: 's1', command: { action: 'snapshot' } })
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ userId: 'u1', sessionId: 's1' })
    const commandId = (published[0].event as { commandId: string }).commandId
    expect(commandId).toStartWith('pc_')

    const settled = reg.resolve(commandId, { ok: true, result: snapResult }, 'u1')
    expect(settled).toBe(true)
    expect(pending).resolves.toEqual({ ok: true, result: snapResult })
  })

  test('resolve is ownership-gated — a different user cannot settle it', () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry, timeoutMs: 50 })

    const pending = reg.send({
      userId: 'owner',
      sessionId: 's1',
      command: { action: 'click', ref: 'e1' },
    })
    const commandId = (published[0].event as { commandId: string }).commandId

    expect(reg.resolve(commandId, { ok: true, result: { action: 'click' } }, 'intruder')).toBe(
      false,
    )
    // The real owner still can.
    expect(reg.resolve(commandId, { ok: false, error: 'nope', errorCode: 'failed' }, 'owner')).toBe(
      true,
    )
    expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'failed' })
  })

  test('resolve returns false for an unknown commandId', () => {
    const { streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })
    expect(reg.resolve('pc_missing', { ok: true, result: snapResult }, 'u1')).toBe(false)
  })

  test('publish failure returns a tool-readable failure and releases the correlation id', async () => {
    const { published, streamRegistry } = fakeRegistry(new Error('serialize failed'))
    const reg = createPreviewCommandRegistry({ streamRegistry, timeoutMs: 5_000 })

    const outcome = await reg.send({
      userId: 'u1',
      sessionId: 's1',
      command: { action: 'snapshot' },
    })
    expect(outcome).toEqual({
      ok: false,
      error: 'Failed to send the Browser command to the UI: serialize failed',
      errorCode: 'failed',
    })
    const commandId = published[0]!.event.commandId!
    expect(reg.resolve(commandId, { ok: true, result: snapResult }, 'u1')).toBe(false)
  })

  test('times out to notEngaged when no client replies', async () => {
    const { streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry, timeoutMs: 20 })
    const outcome = await reg.send({
      userId: 'u1',
      sessionId: 's1',
      command: { action: 'snapshot' },
    })
    expect(outcome).toMatchObject({ ok: false, notEngaged: true })
  })

  test('closeForSession rejects pending commands for that session only', () => {
    const { published, streamRegistry } = fakeRegistry()
    const reg = createPreviewCommandRegistry({ streamRegistry })
    const a = reg.send({ userId: 'u1', sessionId: 's1', command: { action: 'snapshot' } })
    const b = reg.send({ userId: 'u1', sessionId: 's2', command: { action: 'snapshot' } })

    reg.closeForSession('u1', 's1')
    expect(a).resolves.toMatchObject({ ok: false, notEngaged: true })

    // s2 is untouched — its command id can still resolve.
    const idB = (published[1].event as { commandId: string }).commandId
    expect(reg.resolve(idB, { ok: true, result: snapResult }, 'u1')).toBe(true)
    expect(b).resolves.toMatchObject({ ok: true })
  })
})
