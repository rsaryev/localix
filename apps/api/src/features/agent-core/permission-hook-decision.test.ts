import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import type { AgentTool } from '@localixai/agent/agents'

import { createPermissionGate, type PermissionRule } from './permission-engine'
import type { RequestConfirmArgs } from './permission-gate'
import type { PreToolUseVerdict } from './permission-hook-decision'

/**
 * A Claude Code PreToolUse hook's allow/ask at the gate (hooks.md, PreToolUse decision control):
 * "`allow` skips the permission prompt, except for actions no mode auto-approves", "deny and ask
 * rules are still evaluated regardless of what the hook returns", and "`ask` prompts the user".
 */
const ROOT = path.join(os.homedir(), 'proj')
const bash = { name: 'bash' } as unknown as AgentTool
const DANGEROUS: PermissionRule = {
  permission: 'bash',
  pattern: 'dangerous',
  action: 'ask',
  message: 'This command looks destructive. Allow it?',
}

async function decide(rules: PermissionRule[], command: string, hook?: PreToolUseVerdict) {
  const cards: RequestConfirmArgs[] = []
  const gate = createPermissionGate({
    rules,
    toolsByName: new Map([['bash', bash]]),
    root: ROOT,
    requestConfirm: async (args) => {
      cards.push(args)
      return true
    },
  })
  const verdict = await gate({
    toolCallId: 'c1',
    toolName: 'bash',
    input: { command },
    ...(hook ? { hookVerdict: hook } : {}),
  })
  return { verdict, cards }
}

describe('PreToolUse allow', () => {
  test('without a hook a destructive command asks (the control)', async () => {
    expect((await decide([DANGEROUS], 'rm -rf ./build')).cards).toHaveLength(1)
  })

  test('skips the card the mode’s own question would show', async () => {
    const { verdict, cards } = await decide([DANGEROUS], 'rm -rf ./build', { decision: 'allow' })
    expect(cards).toEqual([])
    expect(verdict?.block).toBeUndefined()
    expect(verdict?.provenance).toEqual({ decision: 'rule-allow', detail: 'PreToolUse hook' })
  })

  test('still asks about a call that cannot be undone', async () => {
    const { cards } = await decide([DANGEROUS], 'rm -rf ~', { decision: 'allow' })
    expect(cards).toHaveLength(1)
  })

  test('still asks where a named ask rule says so', async () => {
    const named: PermissionRule = { permission: 'bash', pattern: 'git push*', action: 'ask' }
    const { cards } = await decide([named], 'git push origin main', { decision: 'allow' })
    expect(cards).toHaveLength(1)
  })

  test('never lifts a deny the question was sitting over', async () => {
    const deny: PermissionRule = { permission: 'bash', pattern: '*', action: 'deny' }
    const { verdict, cards } = await decide([deny, DANGEROUS], 'rm -rf ./build', {
      decision: 'allow',
    })
    expect(cards).toEqual([])
    expect(verdict?.block).toBe(true)
  })
})

describe('PreToolUse ask', () => {
  test('shows a card for a call the rules allow, with the hook’s reason', async () => {
    const { cards } = await decide([], 'ls', { decision: 'ask', reason: 'Production host' })
    expect(cards.map((card) => card.message)).toEqual(['Production host'])
  })

  test('does not turn a deny into a question', async () => {
    const deny: PermissionRule = { permission: 'bash', pattern: '*', action: 'deny' }
    const { verdict, cards } = await decide([deny], 'ls', { decision: 'ask' })
    expect(cards).toEqual([])
    expect(verdict?.block).toBe(true)
  })
})
