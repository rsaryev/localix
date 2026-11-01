/** What the goal's decision model is sent never carries a typed secret echoed by the page. */
import { describe, expect, test } from 'bun:test'
import type { DecisionAsk } from '@localixai/mini-app-sdk/backend'

import type { PreviewCommand, PreviewSendOutcome } from '../preview/preview-control'
import { runGoal } from './browser-goal'

const VALUE = 'hunter2-hunter2-hunter2'
const redact = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value).split(VALUE).join('[vault-secret]'))

const send = async (command: PreviewCommand): Promise<PreviewSendOutcome> => ({
  ok: true,
  result: {
    action: command.action as 'snapshot',
    snapshot: {
      tree: `- heading "Welcome back, your key is ${VALUE}"\n- textbox "Token"`,
      stats: { nodes: 2, interactive: 1, chars: 40 },
      url: 'https://x.test/',
      title: 'x',
      elements: [{ ref: 'e1', role: 'textbox', name: 'Token', value: VALUE, editable: true }],
    },
  },
})

describe('the goal action and typed secrets', () => {
  test('the decision model is sent the page with the secret removed', async () => {
    const asked: DecisionAsk[] = []
    const decide = async (ask: DecisionAsk) => {
      asked.push(ask)
      return { status: 'deadline' as const, ms: 1 }
    }
    await runGoal({ send, decide, redact }, { goal: 'Read the page', values: [], previewId: 't' })
    expect(asked.length).toBeGreaterThan(0)
    expect(JSON.stringify(asked)).not.toContain(VALUE)
    expect(JSON.stringify(asked)).toContain('[vault-secret]')
  })
})
