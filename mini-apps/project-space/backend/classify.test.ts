import { expect, test } from 'bun:test'
import { z } from 'zod'
import type { CallClass, MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { SPACE_TOOLS } from '../shared/resource'
import { createSpaceTools } from './tools'
import { createViewTool } from './view-tool'

const ctx = {
  userId: 'u1',
  cwd: '/nowhere',
  z,
  defineTool: (definition: unknown) => definition,
  ui: { offer: (destination: object) => ({ type: 'ui.navigate', ...destination }) },
} as unknown as MiniAppContext
const resolveRoot = async () => '/nowhere'
const tools = [...createSpaceTools(ctx, resolveRoot), createViewTool(ctx, resolveRoot)]

/** What the host's gate computes: the tool's own class, else its static flag read fail-closed. */
function classOf(name: string, input: unknown): CallClass {
  const tool = tools.find((candidate) => candidate.name === name)!
  if (tool.classify) return tool.classify(input)
  return tool.mutates === false ? { effect: 'read' } : { effect: 'external' }
}

const rows: Array<[string, unknown, CallClass]> = [
  [SPACE_TOOLS.read, {}, { effect: 'read' }],
  [SPACE_TOOLS.apply, { ops: [{ op: 'delete', id: 'e1' }] }, { effect: 'files' }],
  [SPACE_TOOLS.view, { fit: true }, { effect: 'view' }],
]

test.each(rows)('%s', (name, input, expected) => {
  expect(classOf(name, input)).toEqual(expected)
})

test('apply stays statically mutating; read and view do not', () => {
  expect(tools.map((tool) => [tool.name, tool.mutates])).toEqual([
    [SPACE_TOOLS.read, false],
    [SPACE_TOOLS.apply, true],
    [SPACE_TOOLS.view, false],
  ])
})
