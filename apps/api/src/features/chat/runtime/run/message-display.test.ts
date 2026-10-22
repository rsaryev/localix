import { describe, expect, test } from 'bun:test'

import type { StoredMessagePayload } from '../../../../db/payload'
import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../cc-hooks'
import { applyDisplayTexts, withDisplayTexts } from './message-display'

const payload = (): StoredMessagePayload => ({
  id: 'reply',
  role: 'assistant',
  from: 'agent:main',
  content: 'First answer.Second answer.',
  items: [
    { id: 't1', type: 'text', status: 'completed', text: 'First answer.' },
    { id: 't2', type: 'text', status: 'completed', text: '  ' },
    { id: 't3', type: 'text', status: 'completed', text: 'Second answer.' },
  ],
})

function hooksShowing(show: (text: string) => string | undefined) {
  const calls: Array<{ turnId: string; messageId: string; text: string }> = []
  const hooks: CcHooksRuntime = {
    ...INERT_CC_HOOKS,
    hasHooks: (event) => event === 'MessageDisplay',
    async runMessageDisplay(message) {
      calls.push(message)
      const shown = show(message.text)
      return shown === undefined ? {} : { displayContent: shown }
    },
  }
  return { hooks, calls }
}

describe('MessageDisplay on a settled reply', () => {
  test('stores what to show beside the text, never in place of it', async () => {
    const { hooks, calls } = hooksShowing((text) =>
      text.startsWith('First') ? 'Shown instead' : undefined,
    )
    const original = payload()
    const shown = await withDisplayTexts(hooks, original, 'turn-1')

    expect(shown.displayTexts).toEqual({ t1: 'Shown instead' })
    // What the model reads back and what a reply hands on stay the original.
    expect(shown.content).toBe(original.content)
    expect(shown.items).toEqual(original.items)
    // Each non-empty text block is one message to the hook, under the turn it belongs to.
    expect(calls).toEqual([
      { turnId: 'turn-1', messageId: 't1', text: 'First answer.' },
      { turnId: 'turn-1', messageId: 't3', text: 'Second answer.' },
    ])
  })

  test('without a MessageDisplay hook the payload is untouched', async () => {
    const original = payload()
    expect(await withDisplayTexts(INERT_CC_HOOKS, original, 'turn-1')).toBe(original)
  })

  test('the reply names the turn when no prompt row exists', async () => {
    const { hooks, calls } = hooksShowing(() => 'x')
    const ctx = { state: { currentPayload: payload() }, assistantMessageId: 'reply-1' }
    await applyDisplayTexts(hooks, ctx, undefined)
    expect(calls[0]?.turnId).toBe('reply-1')
    expect(ctx.state.currentPayload.displayTexts).toEqual({ t1: 'x', t3: 'x' })
  })
})
