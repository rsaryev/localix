import { describe, expect, test } from 'bun:test'
import { memoryFiles, scriptedRunner } from '@rsaryev/llx-plugin/testing'
import { memoryKitPorts } from './testing'

const signal = new AbortController().signal

describe('the kit boundary in memory', () => {
  test('answers from the kit fakes, with the parts a test gives in their place', async () => {
    const commands = scriptedRunner({ stdout: 'hi' })
    const ports = memoryKitPorts({ host: { commands }, trusted: ['/work'] })
    const run = {
      spec: { form: 'exec', command: 'x', args: [] },
      cwd: '/',
      env: {},
      signal,
    } as const
    expect((await ports.host.commands.run(run)).stdout).toBe('hi')
    expect(commands.calls).toHaveLength(1)
    expect(await ports.trust.isFolderTrusted('/work')).toBe(true)
    expect(await ports.trust.isFolderTrusted('/other')).toBe(false)
    expect(await ports.host.mcp.ensureConnected('db', 0, signal)).toBe('unavailable')
  })

  test('keeps state files, env files and directories in memory', async () => {
    const plugin = memoryFiles({ '.claude-plugin/plugin.json': '{}' })
    const ports = memoryKitPorts({ directories: { '/stage': plugin } })
    await ports.marketplace.state.write('installed_plugins.json', '{}', signal)
    expect(await ports.marketplace.state.names(signal)).toEqual(['installed_plugins.json'])
    await ports.marketplace.state.remove('installed_plugins.json', signal)
    expect(await ports.marketplace.state.read('installed_plugins.json', signal)).toBeUndefined()
    expect(await ports.marketplace.staged.open('/stage', signal)).toBe(plugin)
    expect(await ports.marketplace.directories.open('/none', signal)).toBeUndefined()
    const cwd = await ports.envFiles.path('s1', 'cwd', signal)
    expect(await ports.envFiles.path('s2', 'cwd', signal)).not.toBe(cwd)
    await ports.envFiles.clear('s1', 'cwd', signal)
    expect(await ports.envFiles.read(cwd, signal)).toBe('')
    expect(await ports.marketplace.sha256.hex(new Uint8Array())).toHaveLength(64)
  })
})
