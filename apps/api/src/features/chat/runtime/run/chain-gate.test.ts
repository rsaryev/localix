import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'
import type { On } from '@localixai/claude-plugin/mods'

import type { PermissionRule } from '../../../agent-core/permission-engine'
import type { ConfirmOutcome } from '../../../agent-core/permission-gate'
import type { CcHooksRuntime } from '../../../cc-hooks'
import { EMPTY_RUNTIME } from '../../../cc-hooks/runtime-results'
import { hostWithMod } from '../../../mods/testing/testing-host'
import { createChainGate } from './chain-gate'
import { applyToolWrapperChain } from './tool-wrapper-chain'
import { createPermissionGate } from '../../../agent-core/permission-gate'

/**
 * Claude Code decides a call in this order: the mods' `tool.call` hooks, the `PreToolUse` hooks
 * their `next(e)` reaches, `tool.check`, then the mode (a card for the person) and the tool. The
 * defect this pins is the gate at the loop, before every wrapper: the card showed and `tool.check`
 * fired before `tool.call`, so a `tool.call` deny or rewrite came after the person was asked.
 */
const ROOT = path.join(os.homedir(), 'proj')
const logger = { warn: () => {}, info: () => {} }

/** Let pending work run until `ready` holds; no clock is involved. */
async function until(ready: () => boolean) {
  while (!ready()) await new Promise((resolve) => setImmediate(resolve))
}

/** What the model reads of a call, as the loop finishes it: the gate's note leads. */
function modelReads(result: AgentToolResult, note: string | undefined) {
  const parts = result.contentParts
  const body = !parts
    ? [{ type: 'text', text: result.content }]
    : !result.content || parts.some((part) => part.type === 'text')
      ? parts
      : [{ type: 'text', text: result.content }, ...parts]
  const lead = note && !result.isError ? [{ type: 'text', text: `${note}\n\n` }] : []
  const text = [...lead, ...body].map((part) =>
    part.type === 'text' ? (part as { text: string }).text : `[${part.type}]`,
  )
  return { ...result, content: text.join('') }
}

function bashTool(log: string[], output: AgentToolResult): AgentTool {
  return {
    name: 'Bash',
    description: 'run a command',
    activeVerb: 'Running',
    inputSchema: z.object({ command: z.string() }).passthrough(),
    classify: () => ({ effect: 'external' }),
    execute: async (_id: string, input: unknown) => {
      log.push(`run ${(input as { command: string }).command}`)
      return output
    },
  } as unknown as AgentTool
}

interface RunOptions {
  register: (on: On) => void
  answer?: (command: string | undefined) => ConfirmOutcome | Promise<ConfirmOutcome>
  cc?: Partial<CcHooksRuntime>
  /** What the tool returns; `ran` by default. */
  output?: AgentToolResult
}

/** A run's chain and gate, and its calls as the loop makes them: the loop's gate, then the tool. */
async function run({ register, answer = () => ({ approved: true }), cc = {}, output }: RunOptions) {
  const log: string[] = []
  const { scope } = await hostWithMod(register)
  const ccHooks = {
    ...EMPTY_RUNTIME,
    active: true,
    runPreToolUse: async (_name: string, input: { command?: string }) => {
      log.push(`PreToolUse ${input.command}`)
      return { decision: 'proceed' as const }
    },
    runPostToolUse: async () => ({}),
    runPostToolUseFailure: async () => ({}),
    ...cc,
  } as CcHooksRuntime
  const chainGate = createChainGate(scope.gateInChain, {
    approvedInput: (_tool, id) => ccHooks.takeApprovedInput(id),
  })
  const tool = bashTool(log, output ?? { content: 'ran' })
  const [wrapped] = applyToolWrapperChain([tool], {
    miniAppHooks: [],
    miniAppHookOptions: { sessionId: 's1', logger },
    ccHooks,
    logger,
    mods: scope,
    gate: chainGate,
  })
  const rules: PermissionRule[] = [{ permission: 'Bash', pattern: '*', action: 'ask' }]
  const permissionGate = createPermissionGate({
    rules,
    toolsByName: new Map([['Bash', tool]]),
    root: ROOT,
    reviewVerdict: scope.toolCheck()?.review,
    requestConfirm: async (args) => {
      log.push(`card ${args.command}`)
      return answer(args.command)
    },
  })
  const loopGate = chainGate.bind(permissionGate)
  const call = async (id: string, command: string): Promise<AgentToolResult> => {
    const input = { command }
    const verdict = await loopGate({ toolCallId: id, toolName: 'Bash', input })
    if (verdict?.block) return { content: verdict.blockedMessage ?? 'blocked', isError: true }
    // The loop reads the verdict's note once the tool is done, as `executeCall` does.
    const result = await wrapped!.execute(id, input)
    return modelReads(result, verdict?.note)
  }
  return { log, call, chainGate }
}

describe('the permission gate inside tool.call', () => {
  test('tool.call, then PreToolUse, then tool.check, then the card, then the tool', async () => {
    const { log, call } = await run({
      register(on) {
        on('tool.call', { tool: 'Bash' }, ($, e: any, next) => {
          log.push(`tool.call ${e.command}`)
          return next({ ...e, command: `${e.command} --dry-run` })
        })
        on('tool.check', { tool: 'Bash' }, async ($, e: any, next) => {
          const decided: any = await next(e)
          log.push(`tool.check ${e.input.command} ${decided.decision}`)
          return decided
        })
      },
    })
    const result = await call('t1', 'make')
    expect(log).toEqual([
      'tool.call make',
      'PreToolUse make --dry-run',
      'tool.check make --dry-run ask',
      'card make --dry-run',
      'run make --dry-run',
    ])
    expect(result.content).toContain('explicitly APPROVED')
    expect(result.gateProvenance).toEqual({ decision: 'user-approved' })
  })

  test('a tool.call deny refuses the call before anyone is asked', async () => {
    const { log, call } = await run({
      register(on) {
        on('tool.call', { tool: 'Bash' }, ($, e: any, next) =>
          /--force/.test(e.command) ? { deny: 'No force pushes.' } : next(e),
        )
        on('tool.check', { tool: 'Bash' }, ($, e: any, next) => {
          log.push('tool.check')
          return next(e)
        })
      },
    })
    const result = await call('t1', 'git push --force')
    expect(result).toMatchObject({ isError: true, content: 'No force pushes.' })
    expect(result.error?.kind).toBe('blocked')
    expect(log).toEqual([])
  })

  test('a refusal reaches the hook as { deny }, and passed on keeps the gate’s own shape', async () => {
    const seen: unknown[] = []
    const { log, call } = await run({
      answer: () => ({ approved: false, message: 'not today' }),
      register(on) {
        on('tool.call', { tool: 'Bash' }, async ($, e: any, next) => {
          const result = await next(e)
          seen.push(result)
          return result
        })
      },
    })
    const result = await call('t1', 'rm -rf build')
    expect(seen).toEqual([{ deny: expect.stringContaining('User declined Bash.') }])
    expect(result.error).toMatchObject({ kind: 'blocked', refusal: 'human' })
    expect(result.content).toContain('The user replied: not today')
    expect(log).toEqual(['PreToolUse rm -rf build', 'card rm -rf build'])
  })

  test('a PermissionRequest rewrite made at the card is the input the tool runs', async () => {
    const approved = new Map<string, unknown>()
    const { log, call } = await run({
      register(on) {
        on('tool.call', { tool: 'Bash' }, ($, e, next) => next(e))
      },
      answer: () => (approved.set('t1', { command: 'ls -la' }), { approved: true, via: 'hook' }),
      cc: {
        takeApprovedInput: (id) => {
          if (!approved.has(id)) return undefined
          const input = approved.get(id)
          approved.delete(id)
          return { input }
        },
      },
    })
    await call('t1', 'ls')
    expect(log).toEqual(['PreToolUse ls', 'card ls', 'run ls -la'])
  })

  test('cards come one at a time, in the order calls reach the gate', async () => {
    const answers: Array<(outcome: ConfirmOutcome) => void> = []
    const { log, call } = await run({
      register(on) {
        on('tool.call', { tool: 'Bash' }, ($, e, next) => next(e))
      },
      answer: () => new Promise<ConfirmOutcome>((resolve) => answers.push(resolve)),
    })
    const first = call('t1', 'one')
    const second = call('t2', 'two')
    await until(() => answers.length >= 1)
    expect(log.filter((line) => line.startsWith('card'))).toEqual(['card one'])
    answers[0]!({ approved: true })
    await first
    await until(() => answers.length >= 2)
    expect(log.filter((line) => line.startsWith('card'))).toEqual(['card one', 'card two'])
    answers[1]!({ approved: true })
    await second
  })

  test('an approved call’s output as PostToolUse redacted it is what the model reads', async () => {
    const { call } = await run({
      register(on) {
        on('tool.call', { tool: 'Bash' }, ($, e, next) => next(e))
      },
      output: {
        content: 'SECRET-TOKEN',
        contentParts: [{ type: 'image', data: 'AA', mediaType: 'image/png' }],
      },
      cc: { runPostToolUse: async () => ({ updatedToolOutput: 'REDACTED' }) },
    })
    const result = await call('t1', 'screenshot')
    expect(result.content).toContain('explicitly APPROVED')
    expect(result.content).toEndWith('\n\nREDACTED[image]')
    expect(result.content).not.toContain('SECRET-TOKEN')
  })

  test('with no mod hearing tool.call or tool.check the gate stays at the loop', async () => {
    const { log, call, chainGate } = await run({ register: () => {} })
    expect(chainGate.inChain).toBe(false)
    await call('t1', 'make')
    expect(log).toEqual(['card make', 'PreToolUse make', 'run make'])
  })
})
