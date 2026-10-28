import { describe, expect, it } from 'bun:test'

import type { AgentHookEvaluator } from './agent-hook'
import { parseHooksBlock, type SkippedHandler } from './config'
import type { CcHookRegistry } from './contracts'
import { parsePromptHookResult, type PromptHookEvaluator } from './prompt-hook'
import { createCcHooksRuntime } from './run'

/** A hook of `type` on `event`, answered by a model that says `verdict`. */
function runtime(
  event: string,
  type: 'prompt' | 'agent',
  verdict: Awaited<ReturnType<PromptHookEvaluator>>,
  extra: Record<string, unknown> = {},
) {
  const registry: CcHookRegistry = parseHooksBlock(
    { [event]: [{ hooks: [{ type, prompt: 'gate', ...extra }] }] },
    'project',
    { projectDir: '/p' },
  )
  const evaluate: PromptHookEvaluator & AgentHookEvaluator = async () => verdict
  return createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: '/p',
    enabled: true,
    logger: { warn: () => {}, info: () => {} },
    evaluatePromptHook: evaluate,
    runAgentHook: evaluate,
  })
}

const no = { ok: false, reason: 'not yet' } as const

describe('a prompt or agent hook that says impossible on Stop', () => {
  it('lets a prompt hook end the turn instead of sending the reason back', async () => {
    for (const event of ['Stop', 'SubagentStop']) {
      const rt = runtime(event, 'prompt', { ...no, impossible: true })
      const res = event === 'Stop' ? await rt.runStop() : await rt.runSubagentStop('a', 'c', 'x')
      expect(res.blocked).toBe(false)
    }
  })

  it('still sends the reason back without impossible', async () => {
    const res = await runtime('Stop', 'prompt', no).runStop()
    expect(res).toMatchObject({ blocked: true, reason: 'not yet' })
  })

  it('is ignored by an agent hook', async () => {
    const res = await runtime('Stop', 'agent', { ...no, impossible: true }).runStop()
    expect(res).toMatchObject({ blocked: true, reason: 'not yet' })
  })

  it('is read from the model reply', () => {
    expect(parsePromptHookResult('{"ok":false,"reason":"never","impossible":true}')).toEqual({
      ok: false,
      reason: 'never',
      impossible: true,
    })
  })
})

describe('ok:false on PreToolUse', () => {
  it('denies and ends the turn for a prompt hook', async () => {
    const rt = runtime('PreToolUse', 'prompt', no)
    const res = await rt.runPreToolUse('Bash', { command: 'x' })
    expect(res).toMatchObject({ decision: 'deny', reason: 'not yet', stop: { reason: 'not yet' } })
    expect(rt.stoppedBy()).toMatchObject({ event: 'PreToolUse' })
  })

  it('denies and lets Claude adjust with continueOnBlock', async () => {
    const rt = runtime('PreToolUse', 'prompt', no, { continueOnBlock: true })
    const res = await rt.runPreToolUse('Bash', { command: 'x' })
    expect(res).toMatchObject({ decision: 'deny', reason: 'not yet' })
    expect(res).not.toHaveProperty('stop')
    expect(rt.stoppedBy()).toBeUndefined()
  })

  it('lets Claude adjust for an agent hook, which has no continueOnBlock', async () => {
    const rt = runtime('PreToolUse', 'agent', no)
    const res = await rt.runPreToolUse('Bash', { command: 'x' })
    expect(res).toMatchObject({ decision: 'deny', reason: 'not yet' })
    expect(rt.stoppedBy()).toBeUndefined()
  })

  it('reads continueOnBlock on a prompt hook only', () => {
    const reg = parseHooksBlock(
      {
        PreToolUse: [
          {
            hooks: [
              { type: 'prompt', prompt: 'p', continueOnBlock: true },
              { type: 'agent', prompt: 'a', continueOnBlock: true },
            ],
          },
        ],
      },
      'project',
      { projectDir: '/p' },
    )
    expect(reg.PreToolUse![0].handlers.map((h) => h.continueOnBlock)).toEqual([true, undefined])
  })
})

describe('ok:false on PostToolUse and PostToolUseFailure', () => {
  const result = { content: 'done' }

  it('accepts prompt and agent hooks there', () => {
    const skipped: SkippedHandler[] = []
    const reg = parseHooksBlock(
      {
        PostToolUse: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }],
        PostToolUseFailure: [{ hooks: [{ type: 'agent', prompt: 'a' }] }],
      },
      'project',
      { projectDir: '/p' },
      skipped,
    )
    expect(skipped).toEqual([])
    expect(reg.PostToolUse).toHaveLength(1)
    expect(reg.PostToolUseFailure).toHaveLength(1)
  })

  it('ends the turn after the call by default', async () => {
    const rt = runtime('PostToolUse', 'prompt', no)
    await rt.runPostToolUse('Bash', { command: 'x' }, result)
    expect(rt.stoppedBy()).toMatchObject({ event: 'PostToolUse', reason: 'not yet' })
  })

  it('feeds the reason back to Claude with continueOnBlock', async () => {
    const rt = runtime('PostToolUse', 'prompt', no, { continueOnBlock: true })
    const res = await rt.runPostToolUse('Bash', { command: 'x' }, result)
    expect(res.additionalContext).toBe('not yet')
    expect(rt.stoppedBy()).toBeUndefined()
  })

  it('returns the reason as the tool error for PostToolUseFailure, whatever continueOnBlock says', async () => {
    const rt = runtime('PostToolUseFailure', 'prompt', no)
    const res = await rt.runPostToolUseFailure(
      'bash',
      { command: 'x' },
      { error: 'boom', isInterrupt: false },
    )
    expect(res.additionalContext).toBe('not yet')
    expect(rt.stoppedBy()).toBeUndefined()
  })
})

describe('a prompt hook that could not give a verdict', () => {
  it('allows, and says so with a hook error line', async () => {
    const notices: string[] = []
    const registry = parseHooksBlock(
      { PreToolUse: [{ hooks: [{ type: 'prompt', prompt: 'gate' }] }] },
      'project',
      { projectDir: '/p' },
    )
    const rt = createCcHooksRuntime({
      registry,
      sessionId: 's1',
      projectDir: '/p',
      enabled: true,
      logger: { warn: () => {}, info: () => {} },
      emitNotice: (m) => notices.push(m),
      evaluatePromptHook: async () => ({ ok: true, failed: 'the provider is down' }),
    })
    const res = await rt.runPreToolUse('Bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
    expect(notices).toEqual(['PreToolUse:Bash hook error: [prompt]: the provider is down'])
  })

  it('is what a reply without a verdict is', () => {
    expect(parsePromptHookResult('no json here')).toMatchObject({ ok: true })
    expect(parsePromptHookResult('no json here').failed).toBeString()
  })
})
