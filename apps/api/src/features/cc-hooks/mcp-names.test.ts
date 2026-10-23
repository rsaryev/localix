import { describe, expect, it } from 'bun:test'

import {
  ccMcpMatcherVariants,
  ccPluginMcpToolToEngine,
  enginePluginMcpToolName,
  pluginServerRefToEngineMcpTool,
} from './mcp-names'
import { matchesToolName } from './matcher'
import { parseHooksBlock } from './config'

/**
 * CC plugin MCP tool naming (spec: `mcp__plugin_<plugin>_<server>__<tool>`, hook
 * `server: "plugin:<plugin>:<server>"`) aliased onto our engine names
 * (`mcp_<plugin>_<server>_<tool>`) — the pure mapping plus its two wiring points
 * (hook tool matchers, mcp_tool handler resolution).
 */

describe('mcp-names pure mapping', () => {
  it('round-trips the two name forms for a plugin server tool', () => {
    expect(enginePluginMcpToolName('sample-plugin', 'feed', 'get_quote')).toBe(
      'mcp_sample_plugin_feed_get_quote',
    )
    expect(ccPluginMcpToolToEngine('mcp__plugin_sample-plugin_feed__get_quote')).toBe(
      'mcp_sample_plugin_feed_get_quote',
    )
  })

  it('sanitizes non-word chars exactly like the engine namespacedName', () => {
    expect(enginePluginMcpToolName('my-plug', 'a.b', 'do-it')).toBe('mcp_my_plug_a_b_do_it')
    expect(ccPluginMcpToolToEngine('mcp__plugin_my-plug_a.b__do-it')).toBe('mcp_my_plug_a_b_do_it')
  })

  it('ccPluginMcpToolToEngine rejects non-plugin forms', () => {
    expect(ccPluginMcpToolToEngine('mcp__memory__create')).toBeUndefined()
    expect(ccPluginMcpToolToEngine('mcp_sampleplugin_feed_get_quote')).toBeUndefined()
    expect(ccPluginMcpToolToEngine('bash')).toBeUndefined()
  })

  it('resolves the plugin-scoped hook server reference', () => {
    expect(pluginServerRefToEngineMcpTool('plugin:sampleplugin:feed', 'get_quote')).toBe(
      'mcp_sampleplugin_feed_get_quote',
    )
    expect(pluginServerRefToEngineMcpTool('memory', 'create')).toBeUndefined()
    expect(pluginServerRefToEngineMcpTool('plugin:only-one', 't')).toBeUndefined()
  })

  it('ccMcpMatcherVariants rewrites CC forms and passes others through', () => {
    expect(ccMcpMatcherVariants('bash')).toEqual(['bash'])
    expect(ccMcpMatcherVariants('mcp__memory__create')).toContain('mcp_memory_create')
    const pluginForm = ccMcpMatcherVariants('mcp__plugin_sampleplugin_feed__get_quote')
    expect(pluginForm).toContain('mcp_sampleplugin_feed_get_quote') // CC plugin semantics
    expect(pluginForm).toContain('mcp_plugin_sampleplugin_feed_get_quote') // literal server "plugin_…"
  })
})

describe('matcher aliases CC MCP forms onto engine tool names', () => {
  it('exact matchers: generic and plugin forms match the live engine name', () => {
    expect(matchesToolName('mcp__memory__create', 'mcp_memory_create')).toBe(true)
    expect(
      matchesToolName(
        'mcp__plugin_sampleplugin_feed__get_quote',
        'mcp_sampleplugin_feed_get_quote',
      ),
    ).toBe(true)
    expect(
      matchesToolName('mcp__plugin_sampleplugin_feed__get_quote', 'mcp_other_feed_get_quote'),
    ).toBe(false)
    // Engine-form matcher unchanged.
    expect(
      matchesToolName('mcp_sampleplugin_feed_get_quote', 'mcp_sampleplugin_feed_get_quote'),
    ).toBe(true)
  })

  it('regex matchers: CC-form sources are rewritten too', () => {
    expect(matchesToolName('mcp__memory__.*', 'mcp_memory_create')).toBe(true)
    expect(
      matchesToolName('mcp__plugin_sampleplugin_feed__.*', 'mcp_sampleplugin_feed_get_quote'),
    ).toBe(true)
    expect(matchesToolName('mcp__plugin_sampleplugin_feed__.*', 'mcp_memory_create')).toBe(false)
  })
})

describe('mcp_tool handlers resolve plugin-scoped server references', () => {
  const parse = (hook: Record<string, unknown>) =>
    parseHooksBlock({ hooks: { PreToolUse: [{ matcher: '*', hooks: [hook] }] } }, 'plugin', {
      projectDir: '/tmp',
      pluginName: 'sample-plugin',
    }).PreToolUse?.[0]?.handlers[0]

  it('server: "plugin:<plugin>:<server>" resolves to the engine tool name', () => {
    const h = parse({ type: 'mcp_tool', server: 'plugin:sampleplugin:feed', tool: 'get_quote' })
    expect(h?.mcpTool).toBe('mcp_sampleplugin_feed_get_quote')
  })

  it('a full CC plugin tool name resolves to the engine tool name', () => {
    const h = parse({ type: 'mcp_tool', tool: 'mcp__plugin_sampleplugin_feed__get_quote' })
    expect(h?.mcpTool).toBe('mcp_sampleplugin_feed_get_quote')
  })

  it('plain server references keep the generic CC form (runtime caller aliases it)', () => {
    const h = parse({ type: 'mcp_tool', server: 'memory', tool: 'create' })
    expect(h?.mcpTool).toBe('mcp__memory__create')
    const full = parse({ type: 'mcp_tool', tool: 'mcp__memory__create' })
    expect(full?.mcpTool).toBe('mcp__memory__create')
  })
})
