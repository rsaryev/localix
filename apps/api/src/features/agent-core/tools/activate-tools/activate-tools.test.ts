import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { zodToJsonSchema } from '@localixai/agent'

import { buildDeferredEntry, createActivateToolsTool, renderToolCatalog } from './activate-tools'

function tool(name: string, description: string): AgentTool {
  return defineAgentTool({
    name,
    description,
    inputSchema: z.object({ value: z.string() }),
    activeVerb: 'Testing',
    async execute() {
      return { content: 'ok' }
    },
  }) as AgentTool
}

const ENTRIES = [
  buildDeferredEntry(tool('quote_lookup', 'Retrieve current market quotes.'), 'finance'),
  buildDeferredEntry(tool('catalog_query', 'Execute a SQL query.\nReturns rows.'), 'catalog'),
]

describe('renderToolCatalog', () => {
  test('renders stable exact names, sources, and one-line descriptions', () => {
    expect(renderToolCatalog(ENTRIES)).toBe(
      '- catalog_query [catalog]: Execute a SQL query. Returns rows.\n' +
        '- quote_lookup [finance]: Retrieve current market quotes.',
    )
  })
})

describe('createActivateToolsTool', () => {
  test('advertises the compact catalog and marks itself as a model-schema activator', () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const schema = zodToJsonSchema(activate.inputSchema) as {
      properties?: { names?: { items?: { type?: string; enum?: unknown } } }
    }
    expect(activate.name).toBe('activate_tools')
    expect(activate.activatesTools).toBe(true)
    expect(schema.properties?.names?.items?.type).toBe('string')
    expect(schema.properties?.names?.items?.enum).toBeUndefined()
    expect(activate.description).toContain('- catalog_query [catalog]: Execute a SQL query.')
    expect(activate.description).toContain(
      '- quote_lookup [finance]: Retrieve current market quotes.',
    )
  })

  test('activates exact names and treats repeat requests idempotently', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const first = await activate.execute('c1', { names: ['quote_lookup'] })
    const second = await activate.execute('c2', { names: ['quote_lookup'] })

    expect(first.details).toMatchObject({ activated: ['quote_lookup'], alreadyActive: [] })
    expect(second.details).toMatchObject({ activated: [], alreadyActive: ['quote_lookup'] })
  })

  test('returns the full current catalog when the model sends an unknown name', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const result = await activate.execute('c1', { names: ['catalog_qurey'] })

    expect(result.details).toMatchObject({ activated: [], unknown: ['catalog_qurey'] })
    expect(result.content).toContain('Unknown tool names: catalog_qurey.')
    expect(result.content).toContain('Current available tools')
    expect(result.content).toContain('- catalog_query [catalog]: Execute a SQL query.')
    expect(result.content).toContain('- quote_lookup [finance]: Retrieve current market quotes.')
  })

  test('activates valid names while still returning the catalog for invalid siblings', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const result = await activate.execute('c1', { names: ['catalog_query', 'missing'] })

    expect(result.details).toMatchObject({ activated: ['catalog_query'], unknown: ['missing'] })
    expect(result.content).toContain('Activated: catalog_query.')
    expect(result.content).toContain('Unknown tool names: missing.')
    expect(result.content).not.toContain('- catalog_query [catalog]')
    expect(result.content).toContain('- quote_lookup [finance]')
    expect(result.details?.available).toEqual(['quote_lookup'])
  })
})

describe('activation lasts for the session', () => {
  test('the description advertises only tools the session does not already carry', () => {
    const after = createActivateToolsTool({ entries: ENTRIES, sessionActive: ['catalog_query'] })
    expect(after.description).not.toContain('- catalog_query [catalog]')
    expect(after.description).toContain('- quote_lookup [finance]')
    expect(after.description).toContain('already in your tool list is active')
  })

  test('an empty catalog tells the model to call its tools directly', () => {
    const activate = createActivateToolsTool({
      entries: ENTRIES,
      sessionActive: ['catalog_query', 'quote_lookup'],
    })
    expect(activate.description).toContain('No tools remain to activate.')
    expect(activate.description).not.toContain('- catalog_query')
    expect(activate.description).not.toContain('- quote_lookup')
  })

  test('unknown-name recovery excludes tools activated earlier in the run', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    await activate.execute('call-1', { names: ['catalog_query'] })
    const result = await activate.execute('call-2', { names: ['missing'] })
    expect(result.content).not.toContain('- catalog_query [catalog]')
    expect(result.content).toContain('- quote_lookup [finance]')
    expect(result.details?.available).toEqual(['quote_lookup'])
  })

  test('asking for one anyway is answered with "already active", not with "unknown"', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES, sessionActive: ['catalog_query'] })
    const result = await activate.execute('call-1', { names: ['catalog_query'] }, {} as never)

    expect(result.content).toContain('Already active in this session: catalog_query')
    expect(result.content).not.toContain('Unknown tool names')
    expect(result.details).toMatchObject({ activated: [], alreadyActive: ['catalog_query'] })
  })

  test('a new activation is reported to the host so the session can remember it', async () => {
    const remembered: string[][] = []
    const activate = createActivateToolsTool({
      entries: ENTRIES,
      // A block body, not an expression: `push` returns the new length, and the port's return
      // value is meaningful (a host may answer with the names it actually stored).
      onActivated: (names) => {
        remembered.push([...names])
      },
    })

    const first = await activate.execute('call-1', { names: ['quote_lookup'] }, {} as never)
    expect(first.content).toContain('stay available for the rest of this session')
    // The same call twice must not report twice: the host would otherwise write on every repetition.
    await activate.execute('call-2', { names: ['quote_lookup'] }, {} as never)

    expect(remembered).toEqual([['quote_lookup']])
  })
})

describe('giving a tool back', () => {
  test('an eviction is reported in the same answer, and the name becomes activatable again', async () => {
    const activate = createActivateToolsTool({
      entries: ENTRIES,
      sessionActive: ['catalog_query'],
      onActivated: () => ['catalog_query'],
    })

    const first = await activate.execute('call-1', { names: ['quote_lookup'] }, {} as never)
    expect(first.content).toContain(
      "Released to stay within this session's tool budget: catalog_query",
    )
    expect(first.details?.available).toEqual(['catalog_query'])

    // It left the wire, so asking for it again has to be a real activation rather than
    // "already active" — otherwise the model is told it has a tool it does not have.
    const second = await activate.execute('call-2', { names: ['catalog_query'] }, {} as never)
    expect(second.details).toMatchObject({ activated: ['catalog_query'], alreadyActive: [] })
  })

  test('nothing is said when nothing was given back', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES, onActivated: () => [] })
    const result = await activate.execute('call-1', { names: ['quote_lookup'] }, {} as never)

    expect(result.content).not.toContain('Released')
  })
})
