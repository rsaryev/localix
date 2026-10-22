import { describe, it, expect } from 'bun:test'

import { parseHooksBlock, parseScopedHooks } from './config'
import { createCcHooksRuntime } from './run'
import { parsePromptHookResult, mapPromptOutcome, type PromptHookEvaluator } from './prompt-hook'
import type { CcHookRegistry } from './contracts'
import type { SkippedHandler } from './config'

const silentLogger = { warn: () => {}, info: () => {} }

// ---------------------------------------------------------------------------
// Scoped hooks (skill / agent frontmatter) — Stop → SubagentStop conversion
// ---------------------------------------------------------------------------
describe('parseScopedHooks', () => {
  const block = {
    Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
    PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo pre' }] }],
  }

  it('keeps Stop as Stop for an INLINE skill (no conversion)', () => {
    const reg = parseScopedHooks(block, 'skill', { projectDir: '/p' })
    expect(reg.Stop?.length).toBe(1)
    expect(reg.SubagentStop).toBeUndefined()
    expect(reg.Stop![0].handlers[0].source).toBe('skill')
  })

  it('converts Stop → SubagentStop for a sub-agent (fork skill / delegated agent)', () => {
    const reg = parseScopedHooks(block, 'agent', { projectDir: '/p', asSubagent: true })
    expect(reg.Stop).toBeUndefined()
    expect(reg.SubagentStop?.length).toBe(1)
    expect(reg.SubagentStop![0].handlers[0].command).toBe('echo stop')
    // Non-Stop events are untouched by the conversion.
    expect(reg.PreToolUse?.length).toBe(1)
  })

  it('appends the converted Stop group after existing SubagentStop groups', () => {
    const withBoth = {
      Stop: [{ hooks: [{ type: 'command', command: 'from-stop' }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: 'native-substop' }] }],
    }
    const reg = parseScopedHooks(withBoth, 'agent', { projectDir: '/p', asSubagent: true })
    expect(reg.SubagentStop?.map((g) => g.handlers[0].command)).toEqual([
      'native-substop',
      'from-stop',
    ])
  })
})

// ---------------------------------------------------------------------------
// Prompt-handler config parsing (supported events only)
// ---------------------------------------------------------------------------
describe('parseHooksBlock — prompt handlers', () => {
  it('parses a prompt handler on a supported event', () => {
    const reg = parseHooksBlock(
      { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'prompt', prompt: 'is this safe?' }] }] },
      'project',
      { projectDir: '/p' },
    )
    const h = reg.PreToolUse![0].handlers[0]
    expect(h.kind).toBe('prompt')
    expect(h.prompt).toBe('is this safe?')
    // Prompt default timeout is 30 s (not the 600 s command default).
    expect(h.timeoutMs).toBe(30_000)
  })

  it('drops a prompt handler on an UNSUPPORTED event (recorded as skipped)', () => {
    const skipped: SkippedHandler[] = []
    const reg = parseHooksBlock(
      { PostToolUse: [{ hooks: [{ type: 'prompt', prompt: 'review' }] }] },
      'project',
      { projectDir: '/p' },
      skipped,
    )
    expect(reg.PostToolUse).toBeUndefined()
    expect(skipped).toContainEqual({ source: 'project', event: 'PostToolUse', type: 'prompt' })
  })

  it('now PARSES http / mcp_tool / agent on Stop (all supported there)', () => {
    const skipped: SkippedHandler[] = []
    const reg = parseHooksBlock(
      {
        Stop: [
          {
            hooks: [
              { type: 'http', url: 'https://x' },
              { type: 'mcp_tool', server: 'mem', tool: 'check' },
              { type: 'agent', prompt: 'p' },
            ],
          },
        ],
      },
      'user',
      { projectDir: '/p' },
      skipped,
    )
    expect(skipped).toHaveLength(0)
    expect(reg.Stop?.[0]?.handlers.map((h) => h.kind)).toEqual(['http', 'mcp_tool', 'agent'])
  })
})

// ---------------------------------------------------------------------------
// Prompt-hook pure fold layer
// ---------------------------------------------------------------------------
describe('parsePromptHookResult', () => {
  it('extracts the first JSON object even wrapped in prose / fences', () => {
    expect(parsePromptHookResult('Sure! ```json\n{"ok": false, "reason": "nope"}\n```')).toEqual({
      ok: false,
      reason: 'nope',
    })
  })

  it('coerces string booleans', () => {
    expect(parsePromptHookResult('{"ok":"false","reason":"x"}')).toEqual({ ok: false, reason: 'x' })
    expect(parsePromptHookResult('{"ok":"yes"}')).toEqual({ ok: true })
  })

  it('fails open (ok:true) on an unparseable reply', () => {
    expect(parsePromptHookResult('the model rambled with no json')).toEqual({ ok: true })
    expect(parsePromptHookResult('{ not valid json')).toEqual({ ok: true })
  })

  it('does not close early on a brace inside a string', () => {
    expect(parsePromptHookResult('{"ok": false, "reason": "use } carefully"}')).toEqual({
      ok: false,
      reason: 'use } carefully',
    })
  })
})

describe('mapPromptOutcome (per-event ok:false mapping)', () => {
  it('ok:true → empty outcome for every event', () => {
    for (const e of ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop'] as const) {
      expect(mapPromptOutcome(e, { ok: true, reason: 'ignored' })).toEqual({})
    }
  })

  it('PreToolUse ok:false → deny with reason', () => {
    expect(mapPromptOutcome('PreToolUse', { ok: false, reason: 'unsafe' })).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'unsafe',
    })
  })

  it('UserPromptSubmit ok:false → blocked', () => {
    expect(mapPromptOutcome('UserPromptSubmit', { ok: false, reason: 'off-topic' })).toEqual({
      blocked: true,
      blockReason: 'off-topic',
    })
  })

  it('Stop / SubagentStop ok:false → decision block', () => {
    expect(mapPromptOutcome('Stop', { ok: false, reason: 'keep going' })).toEqual({
      decision: 'block',
      reason: 'keep going',
    })
    expect(mapPromptOutcome('SubagentStop', { ok: false, reason: 'not done' })).toEqual({
      decision: 'block',
      reason: 'not done',
    })
  })
})

// ---------------------------------------------------------------------------
// Runtime firing of prompt hooks via an injected (stubbed) evaluator
// ---------------------------------------------------------------------------
function runtimeWith(registry: CcHookRegistry, evaluatePromptHook?: PromptHookEvaluator) {
  return createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: '/p',
    enabled: true,
    logger: silentLogger,
    evaluatePromptHook,
  })
}

describe('prompt hooks fire through the runtime', () => {
  const promptBlock = (event: string) =>
    parseHooksBlock({ [event]: [{ hooks: [{ type: 'prompt', prompt: 'gate' }] }] }, 'project', {
      projectDir: '/p',
    })

  it('PreToolUse ok:false denies the tool call', async () => {
    const stub: PromptHookEvaluator = async () => ({ ok: false, reason: 'blocked by policy' })
    const rt = runtimeWith(promptBlock('PreToolUse'), stub)
    const res = await rt.runPreToolUse('bash', { command: 'rm -rf /' })
    expect(res.decision).toBe('deny')
    expect(res.reason).toBe('blocked by policy')
  })

  it('PreToolUse ok:true proceeds', async () => {
    const stub: PromptHookEvaluator = async () => ({ ok: true })
    const rt = runtimeWith(promptBlock('PreToolUse'), stub)
    const res = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(res.decision).toBe('proceed')
  })

  it('UserPromptSubmit ok:false blocks the prompt', async () => {
    const stub: PromptHookEvaluator = async () => ({ ok: false, reason: 'no' })
    const rt = runtimeWith(promptBlock('UserPromptSubmit'), stub)
    const res = await rt.runUserPromptSubmit('hi')
    expect(res.blocked).toBe(true)
    expect(res.reason).toBe('no')
  })

  it('Stop ok:false requests continuation (blocked)', async () => {
    const stub: PromptHookEvaluator = async () => ({ ok: false, reason: 'more work' })
    const rt = runtimeWith(promptBlock('Stop'), stub)
    const res = await rt.runStop()
    expect(res.blocked).toBe(true)
    expect(res.reason).toBe('more work')
  })

  it('receives the event input JSON appended to the prompt', async () => {
    let seen: { prompt: string; inputJson: string } | null = null
    const stub: PromptHookEvaluator = async (opts) => {
      seen = { prompt: opts.prompt, inputJson: opts.inputJson }
      return { ok: true }
    }
    const rt = runtimeWith(promptBlock('PreToolUse'), stub)
    await rt.runPreToolUse('bash', { command: 'echo hi' })
    expect(seen!.prompt).toBe('gate')
    expect(JSON.parse(seen!.inputJson).tool_name).toBe('Bash')
  })

  it('fails open when NO evaluator is injected', async () => {
    const rt = runtimeWith(promptBlock('PreToolUse')) // no evaluator
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
  })

  it('fails open when the evaluator throws', async () => {
    const stub: PromptHookEvaluator = async () => {
      throw new Error('provider down')
    }
    const rt = runtimeWith(promptBlock('PreToolUse'), stub)
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
  })
})

// ---------------------------------------------------------------------------
// runSubagentStop source filter — no double-fire of generic hooks
// ---------------------------------------------------------------------------
describe('runSubagentStop sourcesOnly filter', () => {
  it('fires only scoped (skill/agent) hooks when sourcesOnly is set', async () => {
    // A user SubagentStop hook + a scoped (agent) one converted from Stop.
    const registry: CcHookRegistry = {}
    const userReg = parseHooksBlock(
      { SubagentStop: [{ hooks: [{ type: 'prompt', prompt: 'user-gate' }] }] },
      'user',
      { projectDir: '/p' },
    )
    const agentReg = parseScopedHooks(
      { Stop: [{ hooks: [{ type: 'prompt', prompt: 'agent-gate' }] }] },
      'agent',
      { projectDir: '/p', asSubagent: true },
    )
    for (const g of userReg.SubagentStop ?? []) (registry.SubagentStop ??= []).push(g)
    for (const g of agentReg.SubagentStop ?? []) (registry.SubagentStop ??= []).push(g)

    const firedPrompts: string[] = []
    const stub: PromptHookEvaluator = async (opts) => {
      firedPrompts.push(opts.prompt)
      return { ok: true }
    }
    const rt = runtimeWith(registry, stub)
    await rt.runSubagentStop('my-agent', 'child-1', 'done', { sourcesOnly: ['skill', 'agent'] })
    expect(firedPrompts).toEqual(['agent-gate']) // user-gate NOT fired
  })
})
