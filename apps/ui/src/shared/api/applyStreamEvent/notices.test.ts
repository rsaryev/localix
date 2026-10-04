import { afterEach, describe, expect, test } from 'bun:test'

import { setPluginSources } from '@/shared/contrib/pluginAttribution'
import type { UiSession } from '../contracts'
import { noticeReducers } from './notices'
import type { StreamEventOf } from './types'

const session = { id: 'S1', messages: [] } as unknown as UiSession
const notice = (event: Omit<StreamEventOf<'hook.notice'>, 'type' | 'sessionId'>) =>
  noticeReducers['hook.notice'](session, { type: 'hook.notice', sessionId: 'S1', ...event })
    .messages[0]?.systemNotice

afterEach(() => setPluginSources([], new Map()))

describe('a hook notice on the transcript', () => {
  // The defect: `detail ?? Hook: …` let the raw text REPLACE the producer, so the notices worth
  // reading closely lost which plugin they came from.
  test("a plugin's notice keeps the plugin's display name beside its raw detail", () => {
    setPluginSources([], new Map([['webhooks', 'Webhooks']]))
    expect(
      notice({
        message: 'The webhook endpoint rejected the delivery.',
        hookEvent: 'webhooks · onAssistantMessage',
        detail: 'HTTP 404 Not Found',
        plugin: { name: 'webhooks', source: 'onAssistantMessage' },
      }),
    ).toMatchObject({
      // A pointer, not a second report: the standing condition row owns the problem; the line
      // marks when it happened, names the plugin, and offers the same settings destination.
      tone: 'neutral',
      text: 'Webhooks reported a problem',
      detail:
        'The webhook endpoint rejected the delivery.\nPlugin: Webhooks · onAssistantMessage\nHTTP 404 Not Found',
      recovery: ['open-settings:plugins/plugin-webhooks'],
    })
  })

  test("a Claude Code hook's notice still names its hook event, with or without detail", () => {
    expect(notice({ message: 'Lint failed', hookEvent: 'PostToolUse' })?.detail).toBe(
      'Hook: PostToolUse',
    )
    expect(
      notice({ message: 'Lint failed', hookEvent: 'PostToolUse', detail: '3 errors' })?.detail,
    ).toBe('Hook: PostToolUse\n3 errors')
  })
})
