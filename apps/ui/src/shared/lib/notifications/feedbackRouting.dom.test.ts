import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { toast } from '@/shared/lib/notify'
import { setActiveEventRoute } from './context'
import {
  resetUnreportedFailuresForTests,
  scheduleUnreportedFailure,
  startUnreportedFailurePublisher,
} from './incidentFallback'
import { acknowledgeInline, inlineFailure } from './inlineReport'
import { httpOperationTitle, socketOperationTitle } from './operationPhrases'
import { resetNotificationsForTests, useNotificationsStore } from './store'
import { addEventTraceStep, resetEventTrace } from './trace'
import { transientFeedback } from './transientFeedback'

/**
 * Where each kind of feedback lands, pinned: an answer to the person's own action is transient and
 * never a journal row; a failure already shown inline is never repeated by the transport's generic
 * row; and that generic row, when it IS written, is headed by a sentence, not an operation.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())
beforeEach(() => {
  resetNotificationsForTests()
  resetEventTrace()
  resetUnreportedFailuresForTests()
  transientFeedback.clear()
  setActiveEventRoute('/project/PRJ-1/LOCALIX-18')
})
afterEach(() => transientFeedback.clear())

const flush = () => new Promise((resolve) => setTimeout(resolve, 5))
const rows = () => useNotificationsStore.getState().entries

describe('an answer to the person’s own action', () => {
  it('info, success, message and the bare call write no journal row and count toward nothing', async () => {
    toast.info('Nothing to export')
    toast.success('Copied')
    toast.message('Indexing…')
    toast('Saved')
    await flush()
    expect(rows()).toEqual([])
    expect(transientFeedback.getSnapshot()).toMatchObject({ message: 'Saved', tone: 'info' })
  })

  it('lands on the transient line with its tone and its follow-up action', () => {
    let undone = false
    toast.success('Cleared 3 queries', {
      action: { label: 'Undo', onClick: () => (undone = true) },
    })
    const shown = transientFeedback.getSnapshot()
    expect(shown).toMatchObject({ message: 'Cleared 3 queries', tone: 'success' })
    shown?.action?.onClick()
    expect(undone).toBe(true)
  })

  it('a failure still reaches the journal (positive control)', async () => {
    toast.error('Could not save “a.ts”')
    toast.warning('Could not reach the language server')
    await flush()
    expect(
      rows()
        .map((row) => row.severity)
        .sort(),
    ).toEqual(['error', 'warning'])
    expect(transientFeedback.getSnapshot()).toBeNull()
  })
})

describe('a failure shown inline', () => {
  const failedRequest = (traceId: string) => {
    const ts = Date.now()
    addEventTraceStep({
      traceId,
      phase: 'failed',
      kind: 'http.patch',
      summary: 'PATCH mcp failed',
      origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: 'PRJ-1' },
      ts,
    })
    scheduleUnreportedFailure(
      {
        traceId,
        summary: 'PATCH mcp failed',
        title: httpOperationTitle('PATCH mcp'),
        origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: 'PRJ-1' },
        ts,
      },
      0,
    )
  }

  it('suppresses the transport’s generic row once acknowledged', async () => {
    const published: string[] = []
    startUnreportedFailurePublisher((failure) => published.push(failure.traceId))
    failedRequest('h1')
    expect(inlineFailure(new Error('The server refused it.'), 'Could not save')).toBe(
      'The server refused it.',
    )
    await flush()
    expect(published).toEqual([])
  })

  it('without the acknowledgement the generic row is written (positive control)', async () => {
    const published: string[] = []
    startUnreportedFailurePublisher((failure) => published.push(failure.title))
    failedRequest('h2')
    await flush()
    expect(published).toEqual(['Could not save the MCP settings'])
  })

  it('a transient answer given for a refused request also reports it', async () => {
    const published: string[] = []
    startUnreportedFailurePublisher((failure) => published.push(failure.traceId))
    failedRequest('h4')
    toast.info('Branch “main” already exists')
    await flush()
    expect(published).toEqual([])
    expect(rows()).toEqual([])
  })

  it('a cancellation acknowledges nothing', async () => {
    const published: string[] = []
    startUnreportedFailurePublisher((failure) => published.push(failure.traceId))
    failedRequest('h3')
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    acknowledgeInline(abort)
    await flush()
    expect(published).toEqual(['h3'])
  })
})

describe('the fallback headline', () => {
  it('is a sentence for every operation, known or not, and never the operation itself', () => {
    expect(httpOperationTitle('PATCH mcp')).toBe('Could not save the MCP settings')
    expect(httpOperationTitle('POST sessions')).toBe('Could not update the conversation')
    expect(httpOperationTitle('DELETE secrets')).toBe('Could not delete the Vault item')
    expect(httpOperationTitle('POST db')).toBe('Could not complete the action')
    expect(httpOperationTitle('GET kube')).toBe('Could not load the data')
    expect(socketOperationTitle('send')).toBe('Could not send the message')
    expect(socketOperationTitle('lsp.hover')).toBe('The language server did not answer')
    expect(socketOperationTitle('frobnicate')).toBe('Could not complete the action')
    for (const title of [httpOperationTitle('PUT whatever'), socketOperationTitle('x.y')]) {
      expect(title).not.toMatch(/\b(GET|POST|PUT|PATCH|DELETE)\b|failed$/)
    }
  })
})
