import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'
import type { TrustSituation } from '@rsaryev/llx-plugin/loading'
import type { PolicyLayer } from '@rsaryev/llx-plugin/settings'

import { createChatPluginSessions } from './sessions'
import { chosenSubagentStatusLine } from './subagent-status-line'
import { diskPluginHost, writeTestPlugin } from './testing'

/**
 * Which `subagentStatusLine` a chat runs (statusline.md, "Subagent status lines"; settings-reference.md,
 * `subagentStatusLine`): a settings file's over a plugin's default, the plugin loaded last among the
 * defaults, and none at all where the gates of `statusLine` hold it: an untrusted folder,
 * `disableAllHooks`, and `allowManagedHooksOnly`, under which a plugin's value never runs.
 */
const scratch = tempDirPerTest('kit-subagent-line-')

const line = (command: string) => ({ type: 'command', command }) as const

async function chosen(options: {
  layers?: PolicyLayer[]
  trust?: TrustSituation
  plugins?: Record<string, string | undefined>
}) {
  const root = scratch()
  const plugins = await Promise.all(
    Object.entries(options.plugins ?? {}).map(([name, command]) =>
      writeTestPlugin(
        join(root, name),
        name,
        command ? { 'settings.json': JSON.stringify({ subagentStatusLine: line(command) }) } : {},
      ),
    ),
  )
  const session = createChatPluginSessions(diskPluginHost(join(root, 'home'))).forRun({
    chatId: 'chat-1',
    cwd: join(root, 'work'),
    transcriptPath: join(root, 'chat-1.jsonl'),
    permissionMode: 'default',
    trust: options.trust ?? 'trusted',
    layers: options.layers ?? [],
    plugins,
  })
  return { root, line: chosenSubagentStatusLine(session, plugins) }
}

describe('the subagent status line a chat runs', () => {
  test('the plugin loaded last sets the default, run in its folder', async () => {
    const { root, line: found } = await chosen({ plugins: { a: 'a.sh', b: undefined, c: 'c.sh' } })
    expect(found).toEqual({
      command: 'c.sh',
      plugin: { id: 'c@test', name: 'c', root: join(root, 'c') },
    })
  })

  test("a settings file's value wins over every plugin default", async () => {
    const { line: found } = await chosen({
      layers: [{ scope: 'user', settings: { subagentStatusLine: line('mine.sh') } }],
      plugins: { a: 'a.sh' },
    })
    expect(found).toEqual({ command: 'mine.sh' })
  })

  test("allowManagedHooksOnly runs the managed value only, never a plugin's", async () => {
    const managedOnly: PolicyLayer = { scope: 'managed', settings: { allowManagedHooksOnly: true } }
    expect((await chosen({ layers: [managedOnly], plugins: { a: 'a.sh' } })).line).toBeUndefined()
    const managedLine: PolicyLayer = {
      scope: 'managed',
      settings: { allowManagedHooksOnly: true, subagentStatusLine: line('corp.sh') },
    }
    expect((await chosen({ layers: [managedLine], plugins: { a: 'a.sh' } })).line).toEqual({
      command: 'corp.sh',
    })
  })

  test('disableAllHooks outside managed settings, or an untrusted folder, runs none', async () => {
    const off: PolicyLayer = { scope: 'user', settings: { disableAllHooks: true } }
    expect((await chosen({ layers: [off], plugins: { a: 'a.sh' } })).line).toBeUndefined()
    const mine: PolicyLayer = { scope: 'user', settings: { subagentStatusLine: line('mine.sh') } }
    expect((await chosen({ layers: [mine], trust: 'dialog' })).line).toBeUndefined()
    expect((await chosen({ plugins: { a: 'a.sh' }, trust: 'dialog' })).line).toBeUndefined()
  })
})
