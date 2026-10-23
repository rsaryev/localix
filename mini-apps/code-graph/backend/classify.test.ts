import { expect, test } from 'bun:test'
import { z } from 'zod'
import type { CallClass, MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { createGraphTools } from './tools'

const ctx = {
  cwd: '/nowhere',
  dataDir: '/nowhere/.cache',
  z,
  defineTool: (tool: unknown) => tool,
  ui: { offer: (destination: object) => ({ type: 'ui.navigate', ...destination }) },
} as unknown as MiniAppContext

/** What the host's gate computes: the tool's own class, else its static flag read fail-closed. */
function classOf(name: string, input: unknown): CallClass {
  const tool = createGraphTools(ctx).find((candidate) => candidate.name === name)!
  if (tool.classify) return tool.classify(input)
  return tool.mutates === false ? { effect: 'read' } : { effect: 'external' }
}

const rows: Array<[string, unknown, CallClass]> = [
  ['code_graph_overview', {}, { effect: 'read' }],
  ['code_graph_search', { query: 'shared' }, { effect: 'read' }],
  ['code_graph_node', { node: 'file:a.ts' }, { effect: 'read' }],
  ['code_graph_impact', { node: 'file:a.ts' }, { effect: 'read' }],
  ['code_graph_path', { from: 'a', to: 'b' }, { effect: 'read' }],
  ['code_graph_show', { nodes: ['file:a.ts'] }, { effect: 'view' }],
  ['code_graph_view', { kind: 'inspect' }, { effect: 'view' }],
  ['code_graph_view', { kind: 'zoom', zoom: 1.5 }, { effect: 'view' }],
]

test.each(rows)('%s %o', (name, input, expected) => {
  expect(classOf(name, input)).toEqual(expected)
})

test('no code graph tool is statically mutating — none writes anything durable', () => {
  for (const tool of createGraphTools(ctx))
    expect({ [tool.name]: tool.mutates }).toEqual({ [tool.name]: false })
})
