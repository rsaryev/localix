import { describe, expect, test } from 'bun:test'

import {
  INERT_CC_HOOKS,
  type CcHooksRuntime,
  type PermissionRequestResult,
} from '../../../cc-hooks'
import { hookConfirmOutcome, raceCardWithPermissionHooks } from './permission-request-hook'

/** A runtime whose PermissionRequest answers when `decide` is called. */
function hooks() {
  let decide!: (result: PermissionRequestResult) => void
  const approved = new Map<string, unknown>()
  const runtime: CcHooksRuntime = {
    ...INERT_CC_HOOKS,
    active: true,
    hasHooks: (event) => event === 'PermissionRequest',
    runPermissionRequest: () => new Promise((resolve) => (decide = resolve)),
    approveWithInput: (id, input) => void approved.set(id, input),
  }
  return { runtime, decide: (r: PermissionRequestResult) => decide(r), approved }
}

/** A card that waits for `answer`, and is withdrawn when its signal fires. */
function card() {
  let answer!: (value: string) => void
  let withdrawn = false
  const ask = (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      answer = resolve
      signal.addEventListener('abort', () => {
        withdrawn = true
        reject(new Error('withdrawn'))
      })
    })
  return { ask, answer: (v: string) => answer(v), withdrawn: () => withdrawn }
}

const call = { toolName: 'bash', input: { command: 'npm run lint' } }

describe('PermissionRequest beside the approval card', () => {
  test('a hook that decides first withdraws the card and its decision applies', async () => {
    const h = hooks()
    const c = card()
    const raced = raceCardWithPermissionHooks(h.runtime, call, new AbortController().signal, c.ask)
    h.decide({ behavior: 'allow', updatedInput: { command: 'npm run lint -- --fix' } })
    expect(await raced).toEqual({
      kind: 'hook',
      decision: { behavior: 'allow', updatedInput: { command: 'npm run lint -- --fix' } },
    })
    expect(c.withdrawn()).toBe(true)
  })

  test('a person who answers first is not overruled by a later hook', async () => {
    const h = hooks()
    const c = card()
    const raced = raceCardWithPermissionHooks(h.runtime, call, new AbortController().signal, c.ask)
    c.answer('approved by person')
    expect(await raced).toEqual({ kind: 'card', value: 'approved by person' })
    h.decide({ behavior: 'deny', message: 'too late' })
  })

  test('a hook with no decision leaves the card to the person', async () => {
    const h = hooks()
    const c = card()
    const raced = raceCardWithPermissionHooks(h.runtime, call, new AbortController().signal, c.ask)
    h.decide({})
    await Promise.resolve()
    c.answer('person')
    expect(await raced).toEqual({ kind: 'card', value: 'person' })
    expect(c.withdrawn()).toBe(false)
  })

  test("the gate reads a hook's allow, rewrite, deny and interrupt", () => {
    const h = hooks()
    expect(
      hookConfirmOutcome(h.runtime, 'tc1', { behavior: 'allow', updatedInput: { command: 'x' } }),
    ).toEqual({ approved: true, via: 'hook' })
    expect(h.approved.get('tc1')).toEqual({ command: 'x' })
    let stopped = false
    expect(
      hookConfirmOutcome(
        h.runtime,
        'tc2',
        { behavior: 'deny', message: 'not on main', interrupt: true },
        () => (stopped = true),
      ),
    ).toEqual({ approved: false, via: 'hook', message: 'not on main' })
    expect(stopped).toBe(true)
  })
})
