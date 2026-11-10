import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createHostPorts, type HostPortsDeps } from './host-ports'
import type { McpCallByName, ModelBackend } from './session-ports'

const dir = tempDirPerTest('kit-host-ports')
const signal = new AbortController().signal

function deps(bound: { mcp?: McpCallByName; models?: ModelBackend } = {}): HostPortsDeps {
  return {
    homeDir: dir(),
    environment: () => ({ PATH: process.env.PATH, ONLY: 'here' }),
    projectDir: () => join(dir(), 'project'),
    pluginRoot: (id) => join(dir(), 'plugins', id),
    pluginsRoot: () => join(dir(), '.localix/plugins'),
    scratchDir: () => join(dir(), 'scratch'),
    envFilesDir: () => join(dir(), 'session'),
    managedDirectory: undefined,
    mcp: () => bound.mcp,
    models: () => bound.models,
  }
}

describe('the ports Localix gives the plugin kit', () => {
  test('gives every port the host and its sessions need', () => {
    const ports = createHostPorts(deps())
    expect(Object.keys(ports.host).toSorted()).toEqual(
      [
        'clock',
        'commands',
        'environment',
        'folders',
        'http',
        'locations',
        'mcp',
        'models',
        'scratch',
      ].toSorted(),
    )
    expect(ports.host.environment.get('ONLY')).toBe('here')
    expect(ports.host.locations.projectDir()).toBe(join(dir(), 'project'))
    expect(ports.classifier).toBeUndefined()
  })

  test('reads an engine that comes up after the ports were made', async () => {
    const bound: { mcp?: McpCallByName; models?: ModelBackend } = {}
    const ports = createHostPorts(deps(bound))
    expect(await ports.host.mcp?.ensureConnected('db', 0, signal)).toBe('unavailable')
    bound.mcp = async () => ({ text: 'ok' })
    bound.models = { complete: async () => 'yes', runAgent: async () => 'done' }
    expect(await ports.host.mcp?.callTool({ server: 'db', tool: 't', input: {}, signal })).toEqual({
      isError: false,
      text: 'ok',
    })
    expect(await ports.host.models?.evaluate({ prompt: 'p', signal })).toEqual({ text: 'yes' })
  })

  test('keeps the marketplace state under the Localix plugins root', async () => {
    const ports = createHostPorts(deps())
    await ports.marketplace.state.write('installed_plugins.json', '{}', signal)
    expect(await ports.marketplace.state.names(signal)).toEqual(['installed_plugins.json'])
    writeTree(join(dir(), '.localix/plugins'), { 'x/.keep': '' })
    expect(
      await ports.marketplace.directories.open(join(dir(), '.localix/plugins/x'), signal),
    ).toBeDefined()
  })

  test('puts env files in the session folder and opens bundles per plugin root', async () => {
    const ports = createHostPorts(deps())
    expect(await ports.envFiles.path('cwd', signal)).toBe(join(dir(), 'session/cwd-env.sh'))
    expect(
      await ports.bundles(join(dir(), 'p')).open({ kind: 'path', path: 'x.mcpb' }, '.mcpb-cache'),
    ).toBeUndefined()
    expect(await ports.trust.isFolderTrusted('/nowhere')).toBe(false)
  })

  test('hands a classifier through only when one is given', async () => {
    const ports = createHostPorts({ ...deps(), classifier: { review: async () => 'allow' } })
    expect(ports.classifier).toBeDefined()
  })
})
