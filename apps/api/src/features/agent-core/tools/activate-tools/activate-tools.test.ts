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
      properties?: { query?: { type?: string; enum?: unknown } }
    }
    expect(activate.name).toBe('ToolSearch')
    expect(activate.activatesTools).toBe(true)
    expect(schema.properties?.query?.type).toBe('string')
    expect(schema.properties?.query?.enum).toBeUndefined()
    expect(activate.description).toContain('- catalog_query [catalog]: Execute a SQL query.')
    expect(activate.description).toContain(
      '- quote_lookup [finance]: Retrieve current market quotes.',
    )
  })

  test('activates exact names and treats repeat requests idempotently', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const first = await activate.execute('c1', { query: 'select:quote_lookup' })
    const second = await activate.execute('c2', { query: 'select:quote_lookup' })

    expect(first.details).toMatchObject({ activated: ['quote_lookup'], alreadyActive: [] })
    expect(second.details).toMatchObject({ activated: [], alreadyActive: ['quote_lookup'] })
  })

  test('returns the full current catalog when the model sends an unknown name', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const result = await activate.execute('c1', { query: 'select:catalog_qurey' })

    expect(result.details).toMatchObject({ activated: [], unknown: ['catalog_qurey'] })
    expect(result.content).toContain('Unknown tool names: catalog_qurey.')
    expect(result.content).toContain('Current available tools')
    expect(result.content).toContain('- catalog_query [catalog]: Execute a SQL query.')
    expect(result.content).toContain('- quote_lookup [finance]: Retrieve current market quotes.')
  })

  test('activates valid names while still returning the catalog for invalid siblings', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const result = await activate.execute('c1', { query: 'select:catalog_query,missing' })

    expect(result.details).toMatchObject({ activated: ['catalog_query'], unknown: ['missing'] })
    expect(result.content).toContain('Activated: catalog_query.')
    expect(result.content).toContain('Unknown tool names: missing.')
    expect(result.content).not.toContain('- catalog_query [catalog]')
    expect(result.content).toContain('- quote_lookup [finance]')
    expect(result.details?.available).toEqual(['quote_lookup'])
  })
})

describe('activation lasts for the session', () => {
  test('the description is the same whatever the session has activated, so the tool list stays put', () => {
    const fresh = createActivateToolsTool({ entries: ENTRIES })
    const after = createActivateToolsTool({ entries: ENTRIES, sessionActive: ['catalog_query'] })
    const all = createActivateToolsTool({
      entries: ENTRIES,
      sessionActive: ['catalog_query', 'quote_lookup'],
    })
    expect(after.description).toBe(fresh.description)
    expect(all.description).toBe(fresh.description)
    expect(after.description).toContain('- catalog_query [catalog]')
    expect(after.description).toContain('already in your tool list is active')
  })

  test('unknown-name recovery excludes tools activated earlier in the run', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    await activate.execute('call-1', { query: 'select:catalog_query' })
    const result = await activate.execute('call-2', { query: 'select:missing' })
    expect(result.content).not.toContain('- catalog_query [catalog]')
    expect(result.content).toContain('- quote_lookup [finance]')
    expect(result.details?.available).toEqual(['quote_lookup'])
  })

  test('asking for one anyway is answered with "already active", not with "unknown"', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES, sessionActive: ['catalog_query'] })
    const result = await activate.execute('call-1', { query: 'select:catalog_query' }, {} as never)

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

    const first = await activate.execute('call-1', { query: 'select:quote_lookup' }, {} as never)
    expect(first.content).toContain('stay available for the rest of this session')
    // The same call twice must not report twice: the host would otherwise write on every repetition.
    await activate.execute('call-2', { query: 'select:quote_lookup' }, {} as never)

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

    const first = await activate.execute('call-1', { query: 'select:quote_lookup' }, {} as never)
    expect(first.content).toContain(
      "Released to stay within this session's tool budget: catalog_query",
    )
    expect(first.details?.available).toEqual(['catalog_query'])

    // It left the wire, so asking for it again has to be a real activation rather than
    // "already active" — otherwise the model is told it has a tool it does not have.
    const second = await activate.execute('call-2', { query: 'select:catalog_query' }, {} as never)
    expect(second.details).toMatchObject({ activated: ['catalog_query'], alreadyActive: [] })
  })

  test('nothing is said when nothing was given back', async () => {
    const activate = createActivateToolsTool({ entries: ENTRIES, onActivated: () => [] })
    const result = await activate.execute('call-1', { query: 'select:quote_lookup' }, {} as never)

    expect(result.content).not.toContain('Released')
  })
})

describe('a tool requested by its Claude Code name', () => {
  // A plugin's MCP tool: Localix's own name, and the name Claude Code's docs and skills use.
  const mcpTool = {
    ...tool('mcp_namekit_db_echo', 'Echo the text back.'),
    aliases: ['mcp__plugin_namekit_db__echo'],
  }
  const entries = [buildDeferredEntry(mcpTool, 'namekit_db'), ...ENTRIES]

  test('activates the tool and tells the model the name to call it by', async () => {
    const activate = createActivateToolsTool({ entries })
    const result = await activate.execute(
      'call-1',
      { query: 'select:mcp__plugin_namekit_db__echo' },
      {} as never,
    )
    expect(result.details?.activated).toEqual(['mcp_namekit_db_echo'])
    expect(result.details?.unknown).toEqual([])
    expect(result.content).toContain('mcp__plugin_namekit_db__echo is mcp_namekit_db_echo')
  })

  test('activates it once when asked under both names', async () => {
    const activate = createActivateToolsTool({ entries })
    const result = await activate.execute(
      'call-1',
      { query: 'select:mcp__plugin_namekit_db__echo,mcp_namekit_db_echo' },
      {} as never,
    )
    expect(result.details?.activated).toEqual(['mcp_namekit_db_echo'])
    expect(result.details?.alreadyActive).toEqual([])
  })
})

describe('a tool offered under a model name', () => {
  // A plugin's MCP tool reaches the model under Claude Code's name; its own name stays the identity.
  const mcpTool = {
    ...tool('mcp_namekit_db_echo', 'Echo the text back.'),
    modelName: 'mcp__plugin_namekit_db__echo',
    aliases: ['mcp__plugin_namekit_db__echo'],
  }
  const entries = [buildDeferredEntry(mcpTool, 'namekit_db'), ...ENTRIES]

  test('the catalog lists it under the model name', () => {
    const activate = createActivateToolsTool({ entries })
    expect(activate.description).toContain('- mcp__plugin_namekit_db__echo [namekit_db]: Echo')
    expect(activate.description).not.toContain('mcp_namekit_db_echo')
  })

  test('a request by the model name activates the own name, with nothing to correct', async () => {
    const activate = createActivateToolsTool({ entries })
    const result = await activate.execute(
      'call-1',
      { query: 'select:mcp__plugin_namekit_db__echo' },
      {} as never,
    )
    expect(result.details?.activated).toEqual(['mcp_namekit_db_echo'])
    expect(result.content).toContain('Activated: mcp__plugin_namekit_db__echo.')
    expect(result.content).not.toContain('Call these by their names here')
    expect(result.content).not.toContain('mcp_namekit_db_echo')
  })

  test('a request by the own name is told the model name to call', async () => {
    const activate = createActivateToolsTool({ entries })
    const result = await activate.execute(
      'call-1',
      { query: 'select:mcp_namekit_db_echo' },
      {} as never,
    )
    expect(result.details?.activated).toEqual(['mcp_namekit_db_echo'])
    expect(result.content).toContain('mcp_namekit_db_echo is mcp__plugin_namekit_db__echo')
  })

  test('already active is reported under the model name', async () => {
    const activate = createActivateToolsTool({ entries, sessionActive: ['mcp_namekit_db_echo'] })
    const result = await activate.execute(
      'call-1',
      { query: 'select:mcp__plugin_namekit_db__echo' },
      {} as never,
    )
    expect(result.details?.alreadyActive).toEqual(['mcp_namekit_db_echo'])
    expect(result.content).toContain(
      'Already active in this session: mcp__plugin_namekit_db__echo.',
    )
  })
})

describe('the Claude Code MCP address in prompt text', () => {
  const github = tool('mcp_github_create_issue', 'Open an issue.')
  const withAlias = { ...tool('mcp_linear_list', 'List issues.'), aliases: ['mcp__linear__list'] }
  const entries = [buildDeferredEntry(github, 'github'), buildDeferredEntry(withAlias, 'linear')]

  test('a tool is activated by mcp__server__tool even when it carries no alias', async () => {
    const activate = createActivateToolsTool({ entries })
    const result = await activate.execute(
      'c',
      { query: 'select:mcp__github__create_issue' },
      {} as never,
    )
    expect(result.details?.activated).toEqual(['mcp_github_create_issue'])
    expect(result.details?.unknown).toEqual([])
    expect(result.content).toContain('mcp__github__create_issue is mcp_github_create_issue')
  })

  test('the catalog shows the address a skill or prompt would use beside the tool’s name', () => {
    const catalog = renderToolCatalog(entries)
    expect(catalog).toContain('mcp_linear_list (mcp__linear__list) [linear]')
    expect(catalog).toContain('- mcp_github_create_issue [github]')
    const activate = createActivateToolsTool({ entries })
    expect(activate.description).toContain('mcp__server__tool')
    expect(JSON.stringify(zodToJsonSchema(activate.inputSchema as never))).toContain('mcp__')
  })

  test('an address that names no tool is unknown, never a near match', async () => {
    const activate = createActivateToolsTool({ entries })
    const result = await activate.execute(
      'c',
      { query: 'select:mcp__github__delete_repo' },
      {} as never,
    )
    expect(result.details?.unknown).toEqual(['mcp__github__delete_repo'])
  })
})

describe('ToolSearch as Claude Code calls it', () => {
  const run = (input: Record<string, unknown>) => {
    const activate = createActivateToolsTool({ entries: ENTRIES })
    const parsed = activate.inputSchema.parse(input)
    return activate.execute('c1', parsed as never)
  }

  test('select: loads the tools it names', async () => {
    const out = await run({ query: 'select:quote_lookup,catalog_query' })
    expect(out.details).toMatchObject({ activated: ['quote_lookup', 'catalog_query'] })
  })

  test('keywords load the best matches, at most max_results', async () => {
    const out = await run({ query: 'sql rows', max_results: 1 })
    expect(out.details).toMatchObject({ activated: ['catalog_query'] })
  })

  test('keywords that match nothing load nothing and show the catalog', async () => {
    const out = await run({ query: 'weather forecast' })
    expect(out.details).toMatchObject({ activated: [] })
    expect(out.content).toContain('quote_lookup')
  })
})
