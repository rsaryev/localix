import { describe, expect, test } from 'bun:test'

import { pluginProblemNotice } from './plugin-problem-notice'

describe('pluginProblemNotice', () => {
  // The client could not tell a plugin's problem from a Claude Code hook's remark, nor which plugin
  // it came from without parsing `hookEvent`'s display text. The frame must say so as data.
  test('names the plugin and its source as data, beside the display text', () => {
    expect(
      pluginProblemNotice({
        sessionId: 'S1',
        pluginName: 'webhooks',
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
      plugin: { name: 'webhooks', source: 'onAssistantMessage' },
    })
  })

  test('a problem with no source or detail carries neither', () => {
    expect(
      pluginProblemNotice({ sessionId: 'S1', pluginName: 'webhooks', message: 'Stopped.' }),
    ).toEqual({
      type: 'hook.notice',
      sessionId: 'S1',
      message: 'Stopped.',
      hookEvent: 'webhooks',
      plugin: { name: 'webhooks' },
    })
  })
})
