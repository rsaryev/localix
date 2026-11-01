import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { createPermissionGate, type RequestConfirmArgs } from './permission-gate'
import { createUncertainWrites } from './tools/uncertain-writes'

const ROOT = path.join(os.homedir(), 'proj')

type Outcome = AgentToolResult | Error

/** An external tool whose runs end as the script says; `hints` is the MCP annotation. */
function fixture(name: string, outcomes: Outcome[], hints: AgentTool['behaviorHints'] = {}) {
  const queue = [...outcomes]
  return {
    name,
    mutates: true,
    behaviorHints: hints,
    async execute() {
      const next = queue.shift() ?? { content: 'ok' }
      if (next instanceof Error) throw next
      return next
    },
  } as unknown as AgentTool
}

/** A run: tools wrapped by the ledger, the gate reading it, a person who says yes to every card. */
function run(tool: AgentTool) {
  const writes = createUncertainWrites()
  const [wrapped] = writes.wrap([tool])
  const cards: RequestConfirmArgs[] = []
  const gate = createPermissionGate({
    rules: [{ permission: '*', pattern: '*', action: 'allow' }],
    toolsByName: new Map([[tool.name, tool]]),
    root: ROOT,
    uncertainWrites: writes,
    requestConfirm: async (args) => (cards.push(args), { approved: true, via: 'user' }),
  })
  const call = async (input: unknown) => {
    await gate({ toolCallId: 'c', toolName: tool.name, input })
    return wrapped!.execute('c', input, undefined as never, undefined, undefined)
  }
  return { call, cards }
}

const networkError = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })

describe('a repeat of a write whose outcome is unknown', () => {
  test('after a network failure the same call asks the person, and the failure says to check', async () => {
    const { call, cards } = run(fixture('send_email', [networkError()]))

    const first = await call({ to: 'a@b.c', body: 'hi' })
    expect(cards).toHaveLength(0)
    expect(first.isError).toBe(true)
    expect(first.content).toContain('may already have taken effect')
    expect(first.content).toContain('Check')

    // Same arguments, keys in another order: still the same call.
    await call({ body: 'hi', to: 'a@b.c' })
    expect(cards).toHaveLength(1)
    expect(cards[0]!.message).toContain('may already have taken effect')
    // A session-wide grant must not wave it through.
    expect(cards[0]!.fresh).toBe(true)
  })

  test('a different call is not asked', async () => {
    const { call, cards } = run(fixture('send_email', [networkError()]))
    await call({ to: 'a@b.c' })
    await call({ to: 'other@b.c' })
    expect(cards).toHaveLength(0)
  })

  test('a success clears the doubt', async () => {
    const { call, cards } = run(fixture('send_email', [networkError(), { content: 'sent' }]))
    await call({ to: 'a@b.c' })
    await call({ to: 'a@b.c' })
    await call({ to: 'a@b.c' })
    expect(cards).toHaveLength(1)
  })

  test('an idempotent tool repeats freely', async () => {
    const { call, cards } = run(fixture('put_item', [networkError()], { idempotentHint: true }))
    const first = await call({ id: 1 })
    await call({ id: 1 })
    expect(cards).toHaveLength(0)
    expect(first.content).not.toContain('may already')
  })

  test('a validation failure never reached the outside', async () => {
    const invalid: AgentToolResult = {
      content: 'to: required',
      isError: true,
      error: { kind: 'validation', message: 'to: required', userMessage: 'bad input' },
    }
    const { call, cards } = run(fixture('send_email', [invalid]))
    const first = await call({})
    await call({})
    expect(cards).toHaveLength(0)
    expect(first.content).toBe('to: required')
  })

  test('a read is unaffected', async () => {
    const reader = { ...fixture('fetch_page', [networkError()]), mutates: false } as AgentTool
    const { call, cards } = run(reader)
    await call({ url: 'x' })
    await call({ url: 'x' })
    expect(cards).toHaveLength(0)
  })
})
