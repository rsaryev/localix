import { afterEach, describe, expect, test } from 'bun:test'

import {
  bindPluginUiToast,
  pluginNotificationCallSite,
  runPluginAction,
  type PluginToast,
  type PluginToastOptions,
} from './notifications'
import { PluginApiError } from './transport'

interface Published {
  message: string
  description?: string
  /** What the host would read as the caller's stack at the moment of the publish. */
  callSite?: string
}

function bindRecordingHost(): Published[] {
  const published: Published[] = []
  const record = (message: string, options?: PluginToastOptions) => {
    published.push({
      message,
      description: options?.description,
      callSite: pluginNotificationCallSite(),
    })
    return published.length
  }
  bindPluginUiToast(
    Object.assign(record, {
      success: record,
      error: record,
      info: record,
      warning: record,
      message: record,
      problems: () => undefined,
      problemsCleared: () => undefined,
    }) as PluginToast,
  )
  return published
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  bindPluginUiToast(undefined as unknown as PluginToast)
})

describe('runPluginAction', () => {
  test('the failure sentence leads and the error message goes under it', async () => {
    const published = bindRecordingHost()
    runPluginAction(() => Promise.reject(new Error('connection refused')), 'Could not connect')
    await settle()
    expect(published).toMatchObject([
      { message: 'Could not connect', description: 'connection refused' },
    ])
  })

  // The defect: a PluginApiError's `detail` — the driver's own words — was dropped, leaving the row
  // with a classified sentence and nothing naming the reason.
  test("a plugin request's detail is kept on its own line under the message", async () => {
    const published = bindRecordingHost()
    const error = new PluginApiError(
      'The server rejected this request.',
      400,
      'bad_sql',
      'syntax error at or near "SELEC"',
    )
    runPluginAction(() => Promise.reject(error), 'Could not run the query')
    await settle()
    expect(published[0]?.description).toBe(
      'The server rejected this request.\nsyntax error at or near "SELEC"',
    )
  })

  test('a detail that only repeats the message is not written twice', () => {
    const published = bindRecordingHost()
    runPluginAction(() => {
      throw new PluginApiError('Port 5432 is taken', 409, null, 'Port 5432 is taken')
    }, 'Could not start the forward')
    expect(published[0]?.description).toBe('Port 5432 is taken')
  })

  test('a rejection with no readable message adds no noise under the sentence', async () => {
    const published = bindRecordingHost()
    runPluginAction(() => Promise.reject({ code: 1 }), 'Could not switch')
    await settle()
    expect(published).toEqual([
      { message: 'Could not switch', description: undefined, callSite: expect.any(String) },
    ])
  })

  // A rejection is handled on a later microtask whose stack no longer holds the plugin, so the host
  // could not tell which plugin failed. The call site recorded at the call must be lent to it.
  test('lends the call-time stack to the host for a deferred publish, and only then', async () => {
    const published = bindRecordingHost()
    function pluginMenuRowHandler() {
      runPluginAction(() => Promise.reject(new Error('nope')), 'Could not stop')
    }
    pluginMenuRowHandler()
    await settle()
    expect(published[0]?.callSite).toContain('pluginMenuRowHandler')
    expect(pluginNotificationCallSite()).toBeUndefined()
  })
})
