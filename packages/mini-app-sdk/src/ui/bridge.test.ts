import { describe, expect, test } from 'bun:test'

import {
  SESSION_EVENT_NAME,
  createBridgeRequests,
  errorMessage,
  forwardableSessionPhase,
  invokeMessage,
  isInvokePayload,
  isMessageFromWindow,
  isMiniAppBridgeMessage,
  isSessionEventData,
  readyMessage,
  resultMessage,
  sessionEventMessage,
  themeMessage,
} from './bridge'

describe('isMiniAppBridgeMessage', () => {
  test('accepts every constructor-built envelope', () => {
    expect(isMiniAppBridgeMessage(readyMessage())).toBe(true)
    expect(isMiniAppBridgeMessage(themeMessage({ theme: 'dark', vars: { '--x': '1' } }))).toBe(true)
    expect(isMiniAppBridgeMessage(invokeMessage('r1', 'ping', { a: 1 }))).toBe(true)
    expect(isMiniAppBridgeMessage(resultMessage('r1', 42))).toBe(true)
    expect(isMiniAppBridgeMessage(errorMessage('r1', 'nope'))).toBe(true)
  })

  test('rejects junk, foreign markers, wrong versions, unknown types, bad ids', () => {
    expect(isMiniAppBridgeMessage(null)).toBe(false)
    expect(isMiniAppBridgeMessage('ready')).toBe(false)
    expect(isMiniAppBridgeMessage({ type: 'ready' })).toBe(false)
    // A foreign bridge's marker must never be mistaken for ours.
    expect(isMiniAppBridgeMessage({ __iwBridge: 'ch', type: 'ready' })).toBe(false)
    expect(isMiniAppBridgeMessage({ lx: 'mini-app-ui', v: 2, type: 'ready' })).toBe(false)
    expect(isMiniAppBridgeMessage({ lx: 'mini-app-ui', v: 1, type: 'hijack' })).toBe(false)
    expect(isMiniAppBridgeMessage({ lx: 'mini-app-ui', v: 1, type: 'invoke', id: 7 })).toBe(false)
  })
})

describe('forwarded session events', () => {
  test('ALLOW-LIST: only run lifecycle types cross, each under its safe phase', () => {
    expect(forwardableSessionPhase('run.started')).toBe('run-started')
    expect(forwardableSessionPhase('run.completed')).toBe('run-completed')
    expect(forwardableSessionPhase('run.failed')).toBe('run-failed')
  })

  // `fs.changed` stays off on purpose, and the reason is not volume: it carries ABSOLUTE paths of
  // the person's files, and this bridge feeds sandboxed iframes from installed mini apps that were
  // promised phase + session id only. Native workbench UI hears file changes through its own door,
  // `miniAppFiles.watchWorkspace` (coalesced, scoped to one chat — `workspace-changes.ts`), which
  // never reaches an iframe.
  test('fs.changed is not a bridge event — file paths never cross into a sandboxed view', () => {
    expect(forwardableSessionPhase('fs.changed')).toBeNull()
  })

  test('everything else — tool I/O, hitl, previews, junk — is NEVER forwarded', () => {
    for (const t of [
      'ui.data',
      'mini-app.command',
      'hitl.requested',
      'preview.updated',
      'terminal.opened',
      'run',
      '',
    ]) {
      expect(forwardableSessionPhase(t)).toBeNull()
    }
  })

  test('sessionEventMessage builds a valid, minimal event envelope', () => {
    const msg = sessionEventMessage('sess-1', 'run-completed')
    expect(isMiniAppBridgeMessage(msg)).toBe(true)
    expect(msg).toEqual({
      lx: 'mini-app-ui',
      v: 1,
      type: 'event',
      payload: { name: SESSION_EVENT_NAME, data: { phase: 'run-completed', sessionId: 'sess-1' } },
    })
  })

  test('isSessionEventData guards the payload shape (phase + sessionId only)', () => {
    expect(isSessionEventData({ phase: 'run-started', sessionId: 's' })).toBe(true)
    expect(isSessionEventData({ phase: 'run-failed', sessionId: 's' })).toBe(true)
    expect(isSessionEventData({ phase: 'bogus', sessionId: 's' })).toBe(false)
    expect(isSessionEventData({ phase: 'run-started' })).toBe(false)
    expect(isSessionEventData({ sessionId: 's' })).toBe(false)
    expect(isSessionEventData(null)).toBe(false)
  })
})

describe('isInvokePayload', () => {
  test('requires a non-empty string action', () => {
    expect(isInvokePayload({ action: 'ping' })).toBe(true)
    expect(isInvokePayload({ action: 'ping', payload: { n: 1 } })).toBe(true)
    expect(isInvokePayload({ action: '' })).toBe(false)
    expect(isInvokePayload({ payload: 1 })).toBe(false)
    expect(isInvokePayload(null)).toBe(false)
  })
})

describe('isMessageFromWindow', () => {
  test('fails CLOSED with no live window; passes only on identity', () => {
    const win = {}
    expect(isMessageFromWindow(null, win)).toBe(false)
    expect(isMessageFromWindow(undefined, null)).toBe(false)
    expect(isMessageFromWindow(win, {})).toBe(false)
    expect(isMessageFromWindow(win, win)).toBe(true)
  })
})

describe('createBridgeRequests', () => {
  test('correlates a result to its pending request by id', async () => {
    const requests = createBridgeRequests()
    const { id, promise } = requests.create<number>()
    expect(requests.size).toBe(1)
    expect(requests.settle(resultMessage(id, 42))).toBe(true)
    expect(promise).resolves.toBe(42)
    expect(requests.size).toBe(0)
  })

  test('rejects with the error payload message', async () => {
    const requests = createBridgeRequests()
    const { id, promise } = requests.create()
    expect(requests.settle(errorMessage(id, 'boom'))).toBe(true)
    expect(promise).rejects.toThrow('boom')
  })

  test('ignores replies that are not ours (unknown id, non-reply types)', () => {
    const requests = createBridgeRequests()
    requests.create()
    expect(requests.settle(resultMessage('someone-elses-id', 1))).toBe(false)
    expect(requests.settle(readyMessage())).toBe(false)
    expect(requests.size).toBe(1)
  })

  test('a settled request cannot be settled twice', async () => {
    const requests = createBridgeRequests()
    const { id, promise } = requests.create()
    expect(requests.settle(resultMessage(id, 'first'))).toBe(true)
    expect(requests.settle(resultMessage(id, 'second'))).toBe(false)
    expect(promise).resolves.toBe('first')
  })

  test('times out when no reply lands', async () => {
    const requests = createBridgeRequests()
    const { promise } = requests.create(5)
    expect(promise).rejects.toThrow('timed out')
    expect(requests.size).toBe(0)
  })

  test('rejectAll flushes every pending request', async () => {
    const requests = createBridgeRequests()
    const a = requests.create()
    const b = requests.create()
    requests.rejectAll(new Error('iframe gone'))
    expect(a.promise).rejects.toThrow('iframe gone')
    expect(b.promise).rejects.toThrow('iframe gone')
    expect(requests.size).toBe(0)
  })

  test('settles replies out of order without consuming other pending requests', async () => {
    const requests = createBridgeRequests()
    const first = requests.create()
    const second = requests.create()
    const value = { answer: 42 }
    expect(requests.settle(resultMessage(second.id, value))).toBe(true)
    expect(await second.promise).toBe(value)
    expect(requests.size).toBe(1)
    expect(requests.settle(errorMessage(first.id, 'first failed'))).toBe(true)
    await expect(first.promise).rejects.toThrow('first failed')
    expect(requests.size).toBe(0)
  })

  test('rejectAll preserves explicit reasons and permits new requests afterward', async () => {
    for (const reason of [false, 0, '', { closed: true }]) {
      const requests = createBridgeRequests()
      const request = requests.create(100)
      const rejected = request.promise.catch((error: unknown) => error)
      requests.rejectAll(reason)
      expect(await rejected).toBe(reason)
      expect(requests.size).toBe(0)
      expect(requests.settle(resultMessage(request.id, 'late'))).toBe(false)
      const next = requests.create()
      expect(next.id).not.toBe(request.id)
      expect(requests.settle(resultMessage(next.id, 'reopened'))).toBe(true)
      expect(await next.promise).toBe('reopened')
    }
  })

  test('mints unique ids', async () => {
    const requests = createBridgeRequests()
    const reqs = [requests.create(), requests.create(), requests.create()]
    expect(new Set(reqs.map((r) => r.id)).size).toBe(3)
    requests.rejectAll()
    // Absorb the intentional rejections so bun doesn't flag them as unhandled.
    for (const r of reqs) await r.promise.catch(() => {})
  })
})
