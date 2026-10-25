import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { observeOptionVault, type OptionVaultPort } from '../ext/option-vault'
import type { McpServerRecord } from './repository'
import { forgetMcpSecrets, hydrateMcpRecords, mcpSecretsSet, sealMcpConfig } from './store-secrets'

/** A vault in memory: what the sealed row may not contain is checked against what it holds. */
function memoryVault() {
  const items = new Map<string, { value: string; version: number }>()
  const port: OptionVaultPort = {
    store: async (_user, key, value) => {
      items.set(key, { value, version: (items.get(key)?.version ?? 0) + 1 })
    },
    resolve: async (_user, key) => items.get(key)?.value ?? null,
    versions: async (_user, prefix) =>
      new Map([...items].filter(([key]) => key.startsWith(prefix)).map(([k, v]) => [k, v.version])),
    remove: async (_user, key) => void items.delete(key),
  }
  return { items, port }
}

const at = { name: 'github', projectId: '' }
const record = (config: Record<string, unknown>, projectId = ''): McpServerRecord => ({
  id: 'id-1',
  userId: 'u1',
  projectId,
  name: 'github',
  description: '',
  transport: 'http',
  config,
  createdAt: '',
  updatedAt: '',
})

describe('MCP server secrets', () => {
  const vault = memoryVault()
  beforeEach(() => observeOptionVault(vault.port))
  afterEach(() => {
    vault.items.clear()
    observeOptionVault(undefined)
  })

  test('the row keeps no header, variable or client secret, and a read gives them back', async () => {
    const config = {
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer abc' },
      env: { TOKEN: 'xyz' },
      oauth: { clientId: 'public-id', clientSecret: 'shh', scope: 'read' },
      timeout: 5000,
    }
    const sealed = await sealMcpConfig('u1', at, config)

    expect(JSON.stringify(sealed)).not.toMatch(/abc|xyz|shh/u)
    expect(sealed.url).toBe('https://mcp.example.com')
    expect(sealed.timeout).toBe(5000)
    expect(sealed.oauth).toEqual({ clientId: 'public-id', scope: 'read' })

    const [read] = await hydrateMcpRecords('u1', [record(sealed)])
    expect(read?.config).toEqual(config)
  })

  test('says which secrets hold a value, without reading them', async () => {
    const sealed = await sealMcpConfig('u1', at, {
      url: 'https://x',
      headers: { A: 'b' },
      oauth: { clientSecret: 'shh' },
    })
    expect(mcpSecretsSet(sealed).sort()).toEqual(['headers', 'oauthClientSecret'])
    expect(mcpSecretsSet({ url: 'https://x' })).toEqual([])
  })

  test('an empty map or secret stores nothing', async () => {
    const sealed = await sealMcpConfig('u1', at, { url: 'https://x', headers: {}, env: {} })
    expect(vault.items.size).toBe(0)
    expect(mcpSecretsSet(sealed)).toEqual([])
  })

  test('a server of the same name in a project keeps its own secrets', async () => {
    await sealMcpConfig('u1', at, { url: 'https://x', headers: { A: 'user' } })
    const project = { name: 'github', projectId: 'p1' }
    const sealed = await sealMcpConfig('u1', project, { url: 'https://x', headers: { A: 'proj' } })

    await forgetMcpSecrets('u1', project)

    const [mine] = await hydrateMcpRecords('u1', [record(sealed, 'p1')])
    expect(mine?.config.headers).toBeUndefined()
    expect(vault.items.size).toBe(1)
  })

  test('without a vault the config stays as written', async () => {
    observeOptionVault(undefined)
    const config = { url: 'https://x', headers: { A: 'b' } }
    expect(await sealMcpConfig('u1', at, config)).toEqual(config)
    expect((await hydrateMcpRecords('u1', [record(config)]))[0]?.config).toEqual(config)
    expect(mcpSecretsSet(config)).toEqual(['headers'])
  })
})
