import { describe, expect, test } from 'bun:test'
import { classifyToolCall, type AgentTool, type CallClass } from '@localixai/agent/agents'

import { createEditTool } from './edit'
import { createWriteTool } from './write'
import { createPatchTool } from '../patch/patch'
import { isPlanFilePath } from '../../../plans/plan-paths'
import { createPermissionGate, type PermissionRule } from '../../permission-engine'
import { scopeToOwnPlan } from './file-call-class'

/**
 * Plan mode refuses `files`, so these classes decide whether the agent can keep its plan as a
 * file. The guard must hold in BOTH directions: the plan files are `session`, and nothing else
 * — a mixed call, a nested path, a non-markdown file, another `.localix` path — rides along.
 */
const CWD = '/repo'
const PLAN = '.localix/plans/LOCALIX-203/PLAN.md'
const SESSION: CallClass = { effect: 'session' }
const FILES: CallClass = { effect: 'files' }

const write = createWriteTool(undefined, CWD)
const edit = createEditTool(undefined, CWD)
const patch = createPatchTool(undefined, CWD)

const patchOf = (...paths: string[]) =>
  [
    '*** Begin Patch',
    ...paths.flatMap((p) => [`*** Update File: ${p}`, '@@', '-a', '+b']),
    '*** End Patch',
  ].join('\n')

describe('the plan path shape', () => {
  test('a markdown file directly inside .localix/plans/<ref>/, and nothing else', () => {
    expect(isPlanFilePath(`${CWD}/${PLAN}`)).toBe(true)
    expect(isPlanFilePath(`${CWD}/.localix/plans/LOCALIX-203/v3.md`)).toBe(true)
    expect(isPlanFilePath(`${CWD}/.localix/plans/LOCALIX-203/notes.txt`)).toBe(false)
    expect(isPlanFilePath(`${CWD}/.localix/plans/LOCALIX-203/sub/PLAN.md`)).toBe(false)
    expect(isPlanFilePath(`${CWD}/.localix/plans/PLAN.md`)).toBe(false)
    expect(isPlanFilePath(`${CWD}/.localix/settings.json`)).toBe(false)
    // Traversal is resolved before the test, so it cannot borrow the shape.
    expect(isPlanFilePath(`${CWD}/.localix/plans/LOCALIX-203/../../../src/a.md`)).toBe(false)
  })
})

describe('scoped to the run’s own conversation', () => {
  // Plan mode's refusal of file writes, the one rule that tells `session` from `files` apart.
  const PLAN_MODE: PermissionRule[] = [{ permission: '*', pattern: 'effect:files', action: 'deny' }]
  const OWN = `${CWD}/.localix/plans/LOCALIX-203`
  const FOREIGN = '.localix/plans/LOCALIX-7/PLAN.md'
  const gateFor = (ownPlanDir: string | undefined) =>
    createPermissionGate({
      rules: PLAN_MODE,
      toolsByName: new Map<string, AgentTool>([
        ['write', write as AgentTool],
        ['apply_patch', patch as AgentTool],
      ]),
      root: CWD,
      hostRoots: [],
      ...(ownPlanDir ? { ownPlanDir } : {}),
    })
  const blocked = async (gate: ReturnType<typeof gateFor>, toolName: string, input: unknown) =>
    (await gate({ toolCallId: 'c', toolName, input }))?.block === true

  test('the class alone accepts any conversation’s plan dir — the gate is what scopes it', () => {
    expect(classifyToolCall(write, { path: FOREIGN, content: 'x' })).toEqual(SESSION)
    expect(scopeToOwnPlan(SESSION, [`${CWD}/${FOREIGN}`], OWN)).toEqual(FILES)
    expect(scopeToOwnPlan(SESSION, [`${CWD}/${PLAN}`], OWN)).toEqual(SESSION)
    // A class that is not `session` is never widened.
    expect(scopeToOwnPlan(FILES, [`${CWD}/${PLAN}`], OWN)).toEqual(FILES)
  })

  test('in plan mode the own plan file is written and a foreign one is refused', async () => {
    const gate = gateFor(OWN)
    expect(await blocked(gate, 'write', { path: PLAN, content: 'x' })).toBe(false)
    expect(await blocked(gate, 'write', { path: FOREIGN, content: 'x' })).toBe(true)
    expect(await blocked(gate, 'apply_patch', { patch: patchOf(PLAN, FOREIGN) })).toBe(true)
  })

  test('a run with no plan dir of its own (a delegated one) writes no plan file', async () => {
    expect(await blocked(gateFor(undefined), 'write', { path: PLAN, content: 'x' })).toBe(true)
  })
})

describe('write / edit / apply_patch', () => {
  test('the plan file, relative or absolute, is session state', () => {
    expect(classifyToolCall(write, { path: PLAN, content: 'x' })).toEqual(SESSION)
    expect(classifyToolCall(write, { path: `${CWD}/${PLAN}`, content: 'x' })).toEqual(SESSION)
    expect(classifyToolCall(edit, { path: PLAN, old_string: 'a', new_string: 'b' })).toEqual(
      SESSION,
    )
    expect(classifyToolCall(patch, { patch: patchOf(PLAN) })).toEqual(SESSION)
  })

  test('any other file stays files — a .localix path outside the plan shape included', () => {
    expect(classifyToolCall(write, { path: 'src/a.ts', content: 'x' })).toEqual(FILES)
    expect(classifyToolCall(write, { path: '.localix/settings.json', content: 'x' })).toEqual(FILES)
    expect(classifyToolCall(edit, { path: 'src/a.ts', old_string: 'a', new_string: 'b' })).toEqual(
      FILES,
    )
  })

  test('a mixed patch stays files, and so does a patch that names no file', () => {
    expect(classifyToolCall(patch, { patch: patchOf(PLAN, 'src/a.ts') })).toEqual(FILES)
    expect(classifyToolCall(patch, { patch: '*** Begin Patch\n*** End Patch' })).toEqual(FILES)
    expect(classifyToolCall(write, {})).toEqual(FILES)
  })
})
