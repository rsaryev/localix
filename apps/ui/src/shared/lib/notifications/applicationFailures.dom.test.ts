import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { setActiveEventRoute } from './context'
import {
  captureApplicationFailure,
  publishUnreportedFailure,
  startGlobalErrorCapture,
} from './applicationFailures'
import { resetNotificationsForTests, useNotificationsStore } from './store'
import { addEventTraceStep, resetEventTrace } from './trace'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())
beforeEach(() => {
  resetNotificationsForTests()
  resetEventTrace()
  setActiveEventRoute('/project/PRJ-1/LOCALIX-18')
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('global application failure capture', () => {
  it('does not manufacture session provenance from the visible route and coalesces repeats', async () => {
    const stop = startGlobalErrorCapture(window)
    try {
      window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('Renderer crashed') }))
      window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('Renderer crashed') }))
      await flush()

      const entries = useNotificationsStore.getState().entries
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        severity: 'error',
        title: 'Something went wrong in Localix',
        message: 'Renderer crashed',
        occurrenceCount: 2,
        origin: { kind: 'application' },
      })
      expect(entries[0]?.trace?.at(-1)).toMatchObject({
        phase: 'event',
        kind: 'application.notification',
      })
      expect(entries[0]?.trace?.some((step) => step.kind === 'application.window')).toBe(true)
    } finally {
      stop()
    }
  })

  it('recovers session provenance only from a causal failed operation', async () => {
    addEventTraceStep({
      traceId: 'request-7',
      phase: 'failed',
      kind: 'api.request',
      summary: 'Save failed',
      origin: { kind: 'session', sessionId: 'LOCALIX-7', projectId: 'PRJ-2' },
    })

    captureApplicationFailure(new Error('Save continuation failed'), {
      surface: 'Background operation',
      kind: 'promise',
    })
    await flush()

    expect(useNotificationsStore.getState().entries[0]?.origin).toEqual({
      kind: 'session',
      sessionId: 'LOCALIX-7',
      projectId: 'PRJ-2',
    })
  })

  it('ignores only the two browser ResizeObserver scheduling diagnostics', async () => {
    const stop = startGlobalErrorCapture(window)
    try {
      const modern = new ErrorEvent('error', {
        message: 'ResizeObserver loop completed with undelivered notifications.',
        cancelable: true,
      })
      const legacy = new ErrorEvent('error', {
        error: new Error('ResizeObserver loop limit exceeded'),
        cancelable: true,
      })
      window.dispatchEvent(modern)
      window.dispatchEvent(legacy)
      captureApplicationFailure(
        new Error('ResizeObserver loop completed with undelivered notifications.'),
        { surface: 'Application', kind: 'window' },
      )
      await flush()

      expect(modern.defaultPrevented).toBe(true)
      expect(legacy.defaultPrevented).toBe(true)
      expect(useNotificationsStore.getState().entries).toEqual([])
    } finally {
      stop()
    }
  })

  it('still records failures thrown by ResizeObserver callback code', async () => {
    const stop = startGlobalErrorCapture(window)
    try {
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: new Error('ResizeObserver callback failed to update the editor'),
        }),
      )
      await flush()

      expect(useNotificationsStore.getState().entries[0]).toMatchObject({
        title: 'Something went wrong in Localix',
        message: 'ResizeObserver callback failed to update the editor',
      })
    } finally {
      stop()
    }
  })

  it('suppresses only Monaco disposed-model resolver rejections', async () => {
    const stop = startGlobalErrorCapture(window)
    try {
      const disposedModel = new Error('Model not found')
      disposedModel.stack =
        'Error: Model not found\n    at y5.createModelReference (https://app.local/editor.api-C2f1ASgP.js:1:839)'
      const event = new Event('unhandledrejection', { cancelable: true }) as Event & {
        reason: unknown
      }
      Object.defineProperty(event, 'reason', { value: disposedModel })
      window.dispatchEvent(event)
      captureApplicationFailure(disposedModel, {
        surface: 'Background operation',
        kind: 'promise',
      })
      await flush()

      expect(event.defaultPrevented).toBe(true)
      expect(useNotificationsStore.getState().entries).toEqual([])

      const realFailure = new Error('Model not found')
      realFailure.stack = 'Error: Model not found\n    at resolveSelectedModel (app.js:10:2)'
      captureApplicationFailure(realFailure, {
        surface: 'Background operation',
        kind: 'promise',
      })
      await flush()

      expect(useNotificationsStore.getState().entries[0]).toMatchObject({
        title: 'A background task stopped unexpectedly',
        message: 'Model not found',
      })
    } finally {
      stop()
    }
  })

  it('heads the fallback row with the human sentence, never the operation summary', async () => {
    publishUnreportedFailure({
      traceId: 'h7',
      summary: 'GET sessions failed',
      title: 'Could not load the conversation',
      origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: null },
      ts: Date.now(),
    })
    await flush()

    expect(useNotificationsStore.getState().entries[0]).toMatchObject({
      title: 'Could not load the conversation',
      message: undefined,
      origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: null },
    })
  })
})
