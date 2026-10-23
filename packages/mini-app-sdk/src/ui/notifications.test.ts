import { afterEach, describe, expect, test } from 'bun:test'

import {
  bindMiniAppUiToast,
  miniAppNotificationCallSite,
  runMiniAppAction,
  type MiniAppToast,
  type MiniAppToastOptions,
} from './notifications'
import { MiniAppApiError } from './transport'

interface Published {
  message: string
  description?: string
  /** What the host would read as the caller's stack at the moment of the publish. */
  callSite?: string
}

function bindRecordingHost(): Published[] {
  const published: Published[] = []
  const record = (message: string, options?: MiniAppToastOptions) => {
    published.push({
      message,
      description: options?.description,
      callSite: miniAppNotificationCallSite(),
    })
    return published.length
  }
  bindMiniAppUiToast(
    Object.assign(record, {
      success: record,
      error: record,
      info: record,
      warning: record,
      message: record,
      problems: () => undefined,
      problemsCleared: () => undefined,
    }) as MiniAppToast,
  )
  return published
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  bindMiniAppUiToast(undefined as unknown as MiniAppToast)
})

describe('runMiniAppAction', () => {
  test('the failure sentence leads and the error message goes under it', async () => {
    const published = bindRecordingHost()
    runMiniAppAction(() => Promise.reject(new Error('connection refused')), 'Could not connect')
    await settle()
    expect(published).toMatchObject([
      { message: 'Could not connect', description: 'connection refused' },
    ])
  })

  // The defect: a MiniAppApiError's `detail` — the driver's own words — was dropped, leaving the row
  // with a classified sentence and nothing naming the reason.
  test("a mini app request's detail is kept on its own line under the message", async () => {
    const published = bindRecordingHost()
    const error = new MiniAppApiError(
      'The server rejected this request.',
      400,
      'bad_sql',
      'syntax error at or near "SELEC"',
    )
    runMiniAppAction(() => Promise.reject(error), 'Could not run the query')
    await settle()
    expect(published[0]?.description).toBe(
      'The server rejected this request.\nsyntax error at or near "SELEC"',
    )
  })

  test('a detail that only repeats the message is not written twice', () => {
    const published = bindRecordingHost()
    runMiniAppAction(() => {
      throw new MiniAppApiError('Port 5432 is taken', 409, null, 'Port 5432 is taken')
    }, 'Could not start the forward')
    expect(published[0]?.description).toBe('Port 5432 is taken')
  })

  test('a rejection with no readable message adds no noise under the sentence', async () => {
    const published = bindRecordingHost()
    runMiniAppAction(() => Promise.reject({ code: 1 }), 'Could not switch')
    await settle()
    expect(published).toEqual([
      { message: 'Could not switch', description: undefined, callSite: expect.any(String) },
    ])
  })

  // A rejection is handled on a later microtask whose stack no longer holds the mini app, so the
  // host could not tell which mini app failed. The call site recorded at the call must be lent to
  // it.
  test('lends the call-time stack to the host for a deferred publish, and only then', async () => {
    const published = bindRecordingHost()
    function miniAppMenuRowHandler() {
      runMiniAppAction(() => Promise.reject(new Error('nope')), 'Could not stop')
    }
    miniAppMenuRowHandler()
    await settle()
    expect(published[0]?.callSite).toContain('miniAppMenuRowHandler')
    expect(miniAppNotificationCallSite()).toBeUndefined()
  })
})
