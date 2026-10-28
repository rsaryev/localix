import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createHumanInLoopController, HumanInLoopDismissedError } from '@localixai/agent/agents'
import type { ConfigChangeRequest, ConfigChangeResponse } from '@localixai/mini-app-sdk/backend'

import { classifyConfigureCall, createConfigureTool } from './configure'
import type { ConfigureHost, ProposalCard } from './configure-contracts'
import { resolveRunProfile } from '../../run-shape'
import { createRuntimeToolRegistry } from '../../tool-registry'
import { buildAgentSystemPrompt } from '../../prompt/assemble'
import { TOOL } from '../../tool-names'

const card: ProposalCard = {
  key: 'tool.enable:loops',
  remedyId: 'tool.enable',
  title: 'Enable the `loops` tool',
  detail: 'Writes a switch.',
  diff: ['+ tool:Loops · * · allow'],
  agentId: 'builtin:localix',
  reload: 'next-run',
}

function harness(over: Partial<ConfigureHost> = {}) {
  const decisions: Array<{ status: string }> = []
  const applied: Array<{ change: unknown }> = []
  const host: ConfigureHost = {
    changeSchema: z.object({ kind: z.literal('tool.enable'), name: z.string() }),
    inspect: async () => 'inspection',
    describe: async () => card,
    apply: async ({ change }) => {
      applied.push({ change })
      return { summary: 'done' }
    },
    recordDecision: async ({ status }) => {
      decisions.push({ status })
    },
    ...over,
  }
  const declined = new Set<string>()
  const tool = createConfigureTool({ sessionId: 'S', host, ledgerRef: {}, declined })
  const humanInLoop = createHumanInLoopController()
  const context = { humanInLoop, interactive: true }
  const propose = () =>
    tool.execute(
      'call-1',
      { action: 'propose', change: { kind: 'tool.enable', name: 'Loops' } },
      undefined,
      undefined,
      context,
    )
  const answer = (approved: boolean) => {
    const pending = humanInLoop.listPending()[0]!.request as ConfigChangeRequest
    const response: ConfigChangeResponse = {
      requestId: pending.id,
      kind: 'config_change',
      payload: { answers: { approved } },
      respondedAt: Date.now(),
    }
    humanInLoop.respond(response)
    return pending
  }
  const humanInLoopPendingCount = () => humanInLoop.listPending().length
  return {
    tool,
    host,
    decisions,
    applied,
    declined,
    humanInLoop,
    propose,
    answer,
    humanInLoopPendingCount,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('configure', () => {
  test('inspect is read-only and needs no human', async () => {
    const { tool } = harness()
    const result = await tool.execute('c', { action: 'inspect' }, undefined, undefined, {})
    expect(result.content).toBe('inspection')
  })

  test('propose raises a config_change request whose payload is the card, then applies on approval', async () => {
    const { propose, answer, applied, decisions } = harness()
    const pending = propose()
    await tick()
    const request = answer(true)
    expect(request.kind).toBe('config_change')
    expect(request.payload.title).toBe(card.title)
    // The card names the agent whose list changes, and the payload carries no choice: there
    // is no second list a proposal could be redirected to.
    expect(request.payload.agentId).toBe('builtin:localix')
    const result = await pending
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('done')
    expect(result.details).toMatchObject({ outcome: 'applied', reload: 'next-run' })
    expect(applied).toEqual([{ change: { kind: 'tool.enable', name: 'Loops' } }])
    expect(decisions.map((d) => d.status)).toEqual(['approved', 'applied'])
  })

  test('a decline is remembered: the same proposal is refused without asking again', async () => {
    const { propose, answer, declined, decisions, humanInLoopPendingCount } = harness()
    const first = propose()
    await tick()
    answer(false)
    const firstResult = await first
    expect(firstResult.isError).toBe(true)
    expect(declined.has(card.key)).toBe(true)
    expect(decisions.map((d) => d.status)).toEqual(['declined'])

    // The repeat never reaches a human — a person's "no" is answered from memory, and it is
    // deliberately not counted as a model mistake (see gate-refusal-tracker's stance).
    const repeat = await propose()
    expect(repeat.isError).toBe(true)
    expect(repeat.content).toContain('earlier in this conversation')
    expect(humanInLoopPendingCount()).toBe(0)
    expect(decisions.map((d) => d.status)).toEqual(['declined'])
  })

  test('dismissing the card counts as a decline, never as an approval', async () => {
    const { propose, humanInLoop, declined, applied, decisions } = harness()
    const pending = propose()
    await tick()
    // Exactly what `hitlRegistry.dismiss` does when a person closes the card.
    humanInLoop.reject(humanInLoop.listPending()[0]!.request.id, new HumanInLoopDismissedError())
    const result = await pending
    expect(result.isError).toBe(true)
    expect(applied).toEqual([])
    expect(declined.has(card.key)).toBe(true)
    expect(decisions.map((d) => d.status)).toEqual(['declined'])
  })

  test('a failed apply is reported as approved-but-not-applied, not as a silent success', async () => {
    const { propose, answer, decisions } = harness({
      apply: async () => {
        throw new Error('Policy changed; reload the rules before saving')
      },
    })
    const pending = propose()
    await tick()
    answer(true)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Policy changed')
    expect(decisions.map((d) => d.status)).toEqual(['approved', 'failed'])
  })

  test('a run with no human cannot propose, and says so instead of hanging', async () => {
    const { tool } = harness()
    const result = await tool.execute(
      'c',
      { action: 'propose', change: { kind: 'tool.enable', name: 'Loops' } },
      undefined,
      undefined,
      { interactive: false },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('No human')
  })

  test('a describe that refuses hands the model the reason, and asks nobody', async () => {
    const { tool, decisions } = harness({
      describe: async () => {
        throw new Error('No agent named "ghost" in this scope.')
      },
    })
    const result = await tool.execute(
      'c',
      { action: 'propose', change: { kind: 'tool.enable', name: 'Loops' } },
      undefined,
      undefined,
      { humanInLoop: createHumanInLoopController(), interactive: true },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('ghost')
    expect(decisions).toEqual([])
  })
})

describe('configure is structurally out of reach of an unattended run', () => {
  const options = {
    sessionId: 'S',
    host: { changeSchema: z.object({ kind: z.literal('tool.enable') }) } as never,
    ledgerRef: {},
    declined: new Set<string>(),
  }

  test('a sub-agent gets neither the schema nor a prompt mention, even if its role declares it', () => {
    const child = createRuntimeToolRegistry({
      policy: {
        agentProfile: resolveRunProfile(
          { sessionKind: 'subagent' },
          { tools: ['read', TOOL.Configure] },
        ),
      },
      optional: { Configure: options },
    })
    expect(child.toolNames).not.toContain(TOOL.Configure)
    // `never`, not `not-declared`: the role DID declare it, and the catalog still refuses.
    expect(child.ledger.get(TOOL.Configure)).toEqual({
      state: 'withheld',
      reason: { layer: 'shape', kind: 'never', shape: 'subagent' },
    })
    const prompt = buildAgentSystemPrompt({ toolRegistry: child } as never)
    expect(prompt).not.toContain('configure')
    expect(prompt).not.toContain('# Unavailable tools')
  })

  test('a chat gets it, and the withheld section points at it', () => {
    const chat = createRuntimeToolRegistry({
      policy: { disabledTools: [TOOL.Loops] },
      optional: { Configure: options, Loops: { userId: 'u', sessionId: 'S', agentId: 'lead' } },
    })
    expect(chat.toolNames).toContain(TOOL.Configure)
    const prompt = buildAgentSystemPrompt({ toolRegistry: chat } as never)
    expect(prompt).toContain('# Unavailable tools')
    expect(prompt).toContain('- Loops —')
  })
})

describe('configure classify', () => {
  // The former classifier answered `read` for anything but propose; an unknown action is now
  // the fail-closed `external`.
  test.each([
    ['inspect', { effect: 'read' }],
    ['propose', { effect: 'host', needsHuman: true }],
    ['unknown', { effect: 'external' }],
  ] as const)('%s', (action, expected) => {
    expect(classifyConfigureCall({ action })).toEqual(expected)
  })

  test('the tool declares the same classifier', () => {
    const { tool } = harness()
    expect(tool.classify?.({ action: 'propose' })).toEqual({ effect: 'host', needsHuman: true })
  })
})
