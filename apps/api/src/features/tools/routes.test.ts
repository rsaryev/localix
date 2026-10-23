import { describe, expect, test } from 'bun:test'

import { createToolsRoutes } from './routes'
import { builtinToolManifest, toolManifest } from './catalog'
import { BUILTIN_TOOL_CATALOG, BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'

const meta = (name: string) => builtinToolManifest().find((tool) => tool.name === name)

describe('tool manifest', () => {
  test('is a set — one entry per tool', () => {
    const names = builtinToolManifest().map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('is a projection of the canonical built-in catalog, not a second inventory', () => {
    // Same tools, same order, and each entry's published metadata taken from the catalog —
    // but only the published FIELDS. The catalog also carries run policy (`exposure`), and a
    // manifest built by spreading it put that on the settings wire the moment it was added.
    expect(builtinToolManifest().map((tool) => tool.name)).toEqual([...BUILTIN_TOOL_NAMES])
    expect(builtinToolManifest()).toEqual(
      Object.values(BUILTIN_TOOL_CATALOG).map((entry) => {
        const { name, label, description, category } = entry
        return {
          name,
          label,
          description,
          category,
          ...('protocol' in entry && entry.protocol ? { required: true } : {}),
        }
      }),
    )
    for (const tool of builtinToolManifest()) {
      expect(Object.keys(tool).sort()).toEqual(
        tool.required
          ? ['category', 'description', 'label', 'name', 'required']
          : ['category', 'description', 'label', 'name'],
      )
    }
  })

  test('does not publish a second toggleability policy beside the canonical inventory', () => {
    for (const tool of builtinToolManifest()) {
      expect('userToggleable' in tool).toBe(false)
    }
  })

  test('the handoff protocol is explicitly required and ordinary tools remain optional', () => {
    expect(meta('set_topic')?.required).toBe(true)
    expect(meta('read')?.required).toBeUndefined()
  })

  test('publishes a built-in with its catalog metadata', () => {
    expect(meta('context_budget')).toEqual({
      name: 'context_budget',
      label: 'Context budget',
      description:
        'Report how much of the context window is used and what remains before the next context checkpoint.',
      category: 'core',
    })
  })

  test('publishes the dependency-injected vault tool in the same toggle catalog', () => {
    expect(meta('vault')).toEqual({
      name: 'vault',
      label: 'Secret vault',
      description: 'Manage encrypted credential metadata without exposing secret values.',
      category: 'knowledge',
    })
  })

  test('publishes the conditional consolidated MCP resource tool', () => {
    expect(meta('mcp_resources')?.name).toBe('mcp_resources')
  })

  test('projects live mini app descriptors into the same toggle manifest without duplicate ownership', () => {
    const miniApps = [
      {
        name: 'fixture-app',
        displayName: 'Sample App',
        enabled: true,
        tools: [
          { name: 'app_query', label: 'Query records', description: 'Run a sample query.' },
          {
            name: 'context_budget',
            label: 'Shadow attempt',
            description: 'Must not replace the core owner.',
          },
        ],
      },
      {
        name: 'disabled',
        enabled: false,
        tools: [{ name: 'hidden', label: 'Hidden', description: 'Disabled mini app tool.' }],
      },
    ]

    expect(toolManifest(miniApps).find((tool) => tool.name === 'app_query')).toEqual({
      name: 'app_query',
      label: 'Query records',
      description: 'Run a sample query.',
      category: 'automation',
      provider: { kind: 'mini-app', id: 'fixture-app', label: 'Sample App' },
    })
    expect(toolManifest(miniApps).filter((tool) => tool.name === 'context_budget')).toHaveLength(1)
    expect(toolManifest(miniApps).some((tool) => tool.name === 'hidden')).toBe(false)
  })

  // `GET /rpc/tools` is gone: the catalog it served was a manifest that knew nothing
  // about the scope's rules or a disabled owner, while the capability snapshot
  // answers the same question with all of it resolved. Two truths about one list is
  // exactly the shape this consolidation set out to remove — what remains under
  // /rpc/tools is the GC report, which joins usage against that snapshot.
  test('serves the GC report and no catalog of its own', async () => {
    const routes = createToolsRoutes()
    expect((await routes.request('/')).status).toBe(404)
    // Without a GC source the report says so, rather than inventing an empty one.
    expect((await routes.request('/gc')).status).toBe(503)
  })
})
