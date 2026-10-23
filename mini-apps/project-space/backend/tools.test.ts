import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { register } from './index'
import { spacePaths } from './paths'
import { createSpaceTools } from './tools'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Result = { content: string; isError?: boolean; details?: { reveal?: unknown } }

/** The mini app's tools, called as a run in chat `s1` would, over a fresh project folder. */
function tools() {
  const root = mkdtempSync(join(tmpdir(), 'project-space-tools-'))
  roots.push(root)
  const ctx = {
    userId: 'u1',
    cwd: root,
    z,
    defineTool: (definition: unknown) => definition,
    ui: { offer: (destination: object) => ({ type: 'ui.navigate', ...destination }) },
  } as unknown as MiniAppContext
  const registered = register(ctx).tools ?? []
  const call = (name: string, input: object) =>
    registered
      .find((candidate) => candidate.name === name)!
      .execute('call-1', input as never, undefined, undefined, {
        session: { id: 's1' },
      } as never) as Promise<Result>
  return {
    root,
    registered,
    read: (input: object = {}) => call('space_read', input),
    apply: (input: object) => call('space_apply', input),
  }
}

describe('the agent tools', () => {
  test('the apply description lists every element type from the registry', () => {
    const { registered } = tools()
    const apply = registered.find((tool) => tool.name === 'space_apply')!
    for (const type of ['note', 'shape', 'frame', 'file', 'folder', 'image', 'document', 'link'])
      expect(apply.description).toContain(`${type}: `)
  })

  test('a batch reports each operation; one refusal does not fail the call', async () => {
    const { apply } = tools()
    const result = await apply({
      ops: [
        { op: 'create', type: 'note', id: 'a', text: 'Start' },
        { op: 'create', type: 'hologram' },
        { op: 'connect', from: 'a', to: 'missing' },
      ],
    })
    expect(result.isError).toBe(false)
    expect(result.content).toStartWith('1 of 3 applied; the refused ones changed nothing.')
    expect(result.content).toContain('1. create a')
    expect(result.content).toContain('2. REFUSED create: unknown type "hologram"')
    expect(result.details?.reveal).toMatchObject({ label: 'Open Project Space' })
  })

  test('a batch where nothing landed is the one failure', async () => {
    const { apply } = tools()
    expect((await apply({ ops: [{ op: 'delete', id: 'nothing' }] })).isError).toBe(true)
  })

  test('the read is a roster naming files by path and flagging the ones that are gone', async () => {
    const { root, apply, read } = tools()
    writeFileSync(join(root, 'kept.ts'), 'export {}')
    await apply({
      ops: [
        { op: 'create', type: 'file', id: 'k', props: { path: 'kept.ts' } },
        { op: 'create', type: 'file', id: 'g', props: { path: 'gone.ts' } },
      ],
    })
    const roster = (await read()).content
    expect(roster).toContain('[k] file (')
    expect(roster).toContain(': kept.ts')
    expect(roster).toContain('gone.ts — MISSING on disk')
  })
})

describe('apply writes only the file the permission gate was shown', () => {
  // The gate used to see the board under `ctx.cwd` while the write went under the session's
  // root: a path rule could approve one file and the call change another.
  /** `apply` over a fresh `ctx.cwd`, with the session resolving to `sessionRoot` (or that cwd). */
  function applyWith(sessionRoot: string | undefined) {
    const cwd = mkdtempSync(join(tmpdir(), 'project-space-cwd-'))
    roots.push(cwd)
    const ctx = {
      userId: 'u1',
      cwd,
      z,
      defineTool: (definition: unknown) => definition,
      ui: { offer: () => undefined },
    } as unknown as MiniAppContext
    const apply = createSpaceTools(ctx, async () => sessionRoot ?? cwd).find(
      (tool) => tool.name === 'space_apply',
    )!
    const run = (ops: object[]) =>
      apply.execute('call-1', { ops } as never, undefined, undefined, {
        session: { id: 's1' },
      } as never) as Promise<Result>
    return { cwd, apply, run }
  }

  test('a session root the gate did not judge is refused and left untouched', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'project-space-elsewhere-'))
    roots.push(elsewhere)
    const { cwd, apply, run } = applyWith(elsewhere)
    const result = await run([{ op: 'create', type: 'note', id: 'a', text: 'x' }])
    expect(result.isError).toBe(true)
    expect(result.content).toContain('nothing was changed')
    expect(existsSync(spacePaths(elsewhere).file)).toBe(false)
    expect(apply.permissionPaths?.({})).toEqual([spacePaths(cwd).file])
  })

  test('the root the gate judged is the file written', async () => {
    const { cwd, apply, run } = applyWith(undefined)
    const result = await run([{ op: 'create', type: 'note', id: 'a', text: 'x' }])
    expect(result.isError).toBe(false)
    expect(apply.permissionPaths?.({})).toEqual([spacePaths(cwd).file])
    expect(existsSync(spacePaths(cwd).file)).toBe(true)
  })
})
