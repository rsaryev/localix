import { describe, expect, test } from 'bun:test'

import { miniAppProblemNotice } from './mini-app-problem-notice'

describe('miniAppProblemNotice', () => {
  // The client could not tell a mini app's problem from a Claude Code hook's remark, nor which app
  // it came from without parsing `hookEvent`'s display text. The frame must say so as data.
  test('names the mini app and its source as data, beside the display text', () => {
    expect(
      miniAppProblemNotice({
        sessionId: 'S1',
        app: 'webhooks',
        message: 'The webhook endpoint rejected the delivery.',
        detail: 'HTTP 404 Not Found',
        source: 'onAssistantMessage',
      }),
    ).toEqual({
      type: 'hook.notice',
      sessionId: 'S1',
      message: 'The webhook endpoint rejected the delivery.',
      hookEvent: 'webhooks · onAssistantMessage',
      detail: 'HTTP 404 Not Found',
      miniApp: { name: 'webhooks', source: 'onAssistantMessage' },
    })
  })

  test('a problem with no source or detail carries neither', () => {
    expect(miniAppProblemNotice({ sessionId: 'S1', app: 'webhooks', message: 'Stopped.' })).toEqual(
      {
        type: 'hook.notice',
        sessionId: 'S1',
        message: 'Stopped.',
        hookEvent: 'webhooks',
        miniApp: { name: 'webhooks' },
      },
    )
  })
})
