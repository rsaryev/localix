import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import type { AgentTool, CallClass } from '@localixai/agent/agents'

import { createPermissionGate, type PermissionRule } from './permission-engine'

/**
 * The gate judges a call on the tool's own class of THAT input (`AgentTool.classify`), and a
 * tool that says nothing is judged the widest way.
 *
 * The defect this pins is the opposite default: a class is a permission input, so a tool that
 * forgot to declare one and was read as a "read" would walk past every rule written about
 * writes — and a session mode that denies `effect:external` would deny nothing at all.
 */
const ROOT = path.join(os.homedir(), 'proj')

const fixture = (name: string, extra: Partial<AgentTool> = {}): AgentTool =>
  ({ name, ...extra }) as unknown as AgentTool

async function verdict(tool: AgentTool, rules: PermissionRule[], input: unknown = {}) {
  const gate = createPermissionGate({
    rules,
    toolsByName: new Map([[tool.name, tool]]),
    root: ROOT,
  })
  return gate({ toolCallId: 'c', toolName: tool.name, input })
}

const blocked = (result: Awaited<ReturnType<typeof verdict>>) => result?.block === true

const denyEffect = (effect: string): PermissionRule[] => [
  { permission: '*', pattern: `effect:${effect}`, action: 'deny' },
]

describe('a tool that declares no class', () => {
  test('with no mutates at all is external — fail-closed', async () => {
    const silent = fixture('silent_tool')
    expect(blocked(await verdict(silent, denyEffect('external')))).toBe(true)
    // The positive control: the same rule about another effect leaves it alone, so the block
    // above is the class answering and not the rule matching everything.
    expect(blocked(await verdict(silent, denyEffect('read')))).toBe(false)
  })

  test('with mutates: true is external too — it says it writes, not where', async () => {
    const writer = fixture('flag_writer', { mutates: true })
    expect(blocked(await verdict(writer, denyEffect('external')))).toBe(true)
    expect(blocked(await verdict(writer, denyEffect('files')))).toBe(false)
  })

  test('with mutates: false is a read', async () => {
    const reader = fixture('flag_reader', { mutates: false })
    expect(blocked(await verdict(reader, denyEffect('read')))).toBe(true)
    expect(blocked(await verdict(reader, denyEffect('external')))).toBe(false)
    expect(
      blocked(await verdict(reader, [{ permission: '*', pattern: 'mutates', action: 'deny' }])),
    ).toBe(false)
  })
})

describe('a tool that classifies its calls', () => {
  // A dual-purpose tool: its static flag says it can write, its classifier says which call does.
  const CLASSES: Record<string, CallClass> = {
    inspect: { effect: 'read' },
    draw: { effect: 'view' },
    move: { effect: 'session' },
    save: { effect: 'files' },
    remember: { effect: 'host' },
    send: { effect: 'external', irreversible: true },
    approve: { effect: 'host', needsHuman: true },
  }
  const dual = fixture('dual_tool', {
    mutates: true,
    classify: (input) =>
      CLASSES[(input as { action?: string }).action ?? ''] ?? { effect: 'external' },
  })

  test.each(Object.entries(CLASSES))(
    '%s is judged by its own effect, not the static flag',
    async (action, callClass) => {
      for (const effect of ['read', 'view', 'session', 'files', 'host', 'external']) {
        const hit = blocked(await verdict(dual, denyEffect(effect), { action }))
        expect({ action, effect, hit }).toEqual({
          action,
          effect,
          hit: effect === callClass.effect,
        })
      }
    },
  )

  test('mutates follows the call: a read passes a deny on mutates, a write does not', async () => {
    const denyMutations: PermissionRule[] = [
      { permission: '*', pattern: 'mutates', action: 'deny' },
    ]
    expect(blocked(await verdict(dual, denyMutations, { action: 'inspect' }))).toBe(false)
    expect(blocked(await verdict(dual, denyMutations, { action: 'draw' }))).toBe(false)
    expect(blocked(await verdict(dual, denyMutations, { action: 'move' }))).toBe(true)
  })

  test('irreversible matches only the calls the tool says cannot be undone', async () => {
    const rules: PermissionRule[] = [{ permission: '*', pattern: 'irreversible', action: 'deny' }]
    expect(blocked(await verdict(dual, rules, { action: 'send' }))).toBe(true)
    expect(blocked(await verdict(dual, rules, { action: 'save' }))).toBe(false)
    // An unknown action is external, but not irreversible: the fallback widens the effect and
    // claims nothing else.
    expect(blocked(await verdict(dual, rules, { action: 'unknown' }))).toBe(false)
  })

  test('needs-human matches only the calls that wait on a person', async () => {
    // The autonomous mode's rule: a run nobody watches must not stop on a card.
    const rules: PermissionRule[] = [{ permission: '*', pattern: 'needs-human', action: 'deny' }]
    expect(blocked(await verdict(dual, rules, { action: 'approve' }))).toBe(true)
    expect(blocked(await verdict(dual, rules, { action: 'remember' }))).toBe(false)
  })

  test('the plan mode list lets reads, views and session moves through and stops the rest', async () => {
    const plan: PermissionRule[] = ['files', 'host', 'external'].flatMap(denyEffect)
    const passes = async (action: string) => !blocked(await verdict(dual, plan, { action }))
    expect(await passes('inspect')).toBe(true)
    expect(await passes('draw')).toBe(true)
    expect(await passes('move')).toBe(true)
    expect(await passes('save')).toBe(false)
    expect(await passes('remember')).toBe(false)
    expect(await passes('send')).toBe(false)
    expect(await passes('unknown')).toBe(false)
  })
})
