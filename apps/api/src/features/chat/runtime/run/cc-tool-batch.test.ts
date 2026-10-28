import { describe, expect, test } from 'bun:test'

import { INERT_CC_HOOKS, type CcHooksRuntime, type CcToolBatchCall } from '../../../cc-hooks'
import { ccAfterToolBatch, ccHookStopRule, POST_TOOL_BATCH_STOP } from './cc-tool-batch'

const batch = {
  calls: [
    { toolCallId: 't1', toolName: 'Read', input: { path: 'a' }, result: { content: '1\ta' } },
  ],
}
const signal = new AbortController().signal

function hooks(verdict: Awaited<ReturnType<CcHooksRuntime['runPostToolBatch']>>) {
  const seen: CcToolBatchCall[][] = []
  const runtime: CcHooksRuntime = {
    ...INERT_CC_HOOKS,
    active: true,
    hasHooks: (event) => event === 'PostToolBatch',
    runPostToolBatch: async (calls) => {
      seen.push([...calls])
      return verdict
    },
  }
  return { runtime, seen }
}

describe('PostToolBatch on the loop seam', () => {
  test('no PostToolBatch hooks: no seam at all', () => {
    expect(ccAfterToolBatch(INERT_CC_HOOKS, () => {})).toBeUndefined()
  })

  test('each call goes to the hooks with the content the model reads; context comes back once', async () => {
    const h = hooks({ stop: false, additionalContext: 'run pytest' })
    const verdict = await ccAfterToolBatch(h.runtime, () => {})!(batch, signal)
    expect(h.seen).toEqual([
      [
        {
          tool_name: 'Read',
          tool_input: { path: 'a', file_path: 'a' },
          tool_use_id: 't1',
          tool_response: '1\ta',
        },
      ],
    ])
    expect(verdict?.messages).toHaveLength(1)
    expect(JSON.stringify(verdict?.messages)).toContain('run pytest')
  })

  test('a block ends the run, and the person reads why', async () => {
    const h = hooks({ stop: true, reason: 'lint failed' })
    const notices: string[] = []
    expect(await ccAfterToolBatch(h.runtime, (r) => notices.push(r))!(batch, signal)).toEqual({
      stop: POST_TOOL_BATCH_STOP,
    })
    expect(notices).toEqual(['lint failed'])
  })

  test('after a PreToolUse continue:false, no PostToolBatch hook runs', async () => {
    const h = hooks({ stop: false, additionalContext: 'run pytest' })
    const runtime: CcHooksRuntime = {
      ...h.runtime,
      stoppedBy: () => ({ event: 'PreToolUse', reason: 'Build failed' }),
    }
    expect(await ccAfterToolBatch(runtime, () => {})!(batch, signal)).toBeUndefined()
    expect(h.seen).toEqual([])
  })
})

describe('a hook stop at the batch boundary', () => {
  test('ends the run once a hook stopped it, even when a sibling call ran', async () => {
    let stop: ReturnType<CcHooksRuntime['stoppedBy']>
    const rule = ccHookStopRule({ ...INERT_CC_HOOKS, stoppedBy: () => stop })
    expect(rule.shouldStop()).toBe(false)
    stop = { event: 'PreToolUse', reason: 'Build failed' }
    expect(rule.shouldStop()).toBe(true)
  })
})
