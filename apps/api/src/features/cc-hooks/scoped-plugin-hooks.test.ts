/**
 * A plugin's skill (or agent) frontmatter `hooks` block is a plugin component: its commands get
 * the plugin's `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`, like the plugin's own hooks.json.
 */
import { describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { parseScopedHooks } from './config'
import type { CcHookInput } from './contracts'
import { executeHook } from './executor'

const dir = tempDirPerTest('cc-scoped-plugin-')
const silent = { warn: () => {}, info: () => {} }
const input = { hook_event_name: 'PreToolUse', session_id: 's1' } as unknown as CcHookInput

const block = {
  PreToolUse: [
    {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/scripts/check.sh"' }],
    },
  ],
  Stop: [{ hooks: [{ type: 'command', command: 'true' }] }],
}

describe('parseScopedHooks with the shipping plugin', () => {
  it('runs a skill hook from the plugin root with the plugin data dir in its env', async () => {
    const root = join(dir(), 'plugin')
    const dataDir = join(dir(), 'data')
    const out = join(dir(), 'ran.txt')
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(
      join(root, 'scripts', 'check.sh'),
      `#!/bin/sh\nprintf '%s|%s' "$CLAUDE_PLUGIN_ROOT" "$CLAUDE_PLUGIN_DATA" > '${out}'\n`,
    )
    chmodSync(join(root, 'scripts', 'check.sh'), 0o755)

    const registry = parseScopedHooks(block, 'skill', {
      projectDir: dir(),
      plugin: { name: 'kit', root, dataDir },
    })
    const handler = registry.PreToolUse?.[0]?.handlers[0]
    expect(handler).toMatchObject({ source: 'skill', pluginName: 'kit', pluginRoot: root })

    expect(await executeHook(handler!, input, dir(), silent, false)).toEqual({})
    expect(readFileSync(out, 'utf8')).toBe(`${root}|${dataDir}`)
  })

  it('keeps the plugin on a forked skill whose Stop becomes SubagentStop', () => {
    const registry = parseScopedHooks(block, 'skill', {
      projectDir: dir(),
      asSubagent: true,
      plugin: { name: 'kit', root: '/plugins/kit', dataDir: '/data/kit' },
    })
    expect(registry.SubagentStop?.[0]?.handlers[0]).toMatchObject({
      pluginRoot: '/plugins/kit',
      pluginDataDir: '/data/kit',
    })
  })

  it("gives a person's own skill no plugin root", () => {
    const handler = parseScopedHooks(block, 'skill', { projectDir: dir() }).PreToolUse?.[0]
      ?.handlers[0]
    expect(handler?.pluginRoot).toBeUndefined()
    expect(handler?.pluginName).toBeUndefined()
  })
})
